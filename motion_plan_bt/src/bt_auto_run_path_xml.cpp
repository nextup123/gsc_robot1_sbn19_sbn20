/**
 * @file auto_run_path_xml.cpp
 * @author Adnan Alvi
 * @brief BT node to generate run_path_tree.xml with grouped paths by MAX(sequence)
 * @version 1.0
 * @date 2025-11-01
 */

#include "auto_run_path_xml.hpp"
#include <random>
#include <algorithm>
#include <sstream>

namespace fs = std::filesystem;

namespace auto_run_path_xml
{

    AutoRunPathXml::AutoRunPathXml(
        const std::string &name,
        const BT::NodeConfiguration &config,
        const rclcpp::Node::SharedPtr &node)
        : BT::SyncActionNode(name, config), node_(node)
    {
        // Declare parameters with defaults
        input_file_path_ = node_->declare_parameter<std::string>(
            "input_file_path", "/home/nextup/NextupRobot/src/active_project_configs/planning_data/paths.yaml");
        xml_file_path_ = node_->declare_parameter<std::string>(
            "xml_file_path", "/home/nextup/NextupRobot/src/active_project_configs/control_data/run_path.xml");
        sequence_points_file_path = node_->declare_parameter<std::string>(
            "sequence_points_file_path", "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");

        status_pub_ = node_->create_publisher<std_msgs::msg::String>("/bt_toast_popup", 10);

        RCLCPP_INFO(node_->get_logger(), "AutoRunPathXml BT node initialized");
    }

    BT::PortsList AutoRunPathXml::providedPorts()
    {
        return {
            BT::InputPort<std::string>("input_file_path"),
            BT::InputPort<std::string>("xml_file_path"),
            BT::InputPort<std::string>("points_file_path")};
    }

    BT::NodeStatus AutoRunPathXml::tick()
    {
        // === Read ports (override params if provided) ===
        std::string input_file_path, xml_file_path, points_file_path;
        if (!getInput("input_file_path", input_file_path))
            input_file_path = input_file_path_;
        if (!getInput("xml_file_path", xml_file_path))
            xml_file_path = xml_file_path_;
        if (!getInput("points_file_path", points_file_path))
            points_file_path = sequence_points_file_path;

        // === Validate files ===
        if (!fs::exists(input_file_path))
        {
            publish_status("paths.yaml not found", "failure", 0);
            return BT::NodeStatus::FAILURE;
        }
        if (!fs::exists(points_file_path))
        {
            publish_status("points.yaml not found", "failure", 0);
            return BT::NodeStatus::FAILURE;
        }

        // === Load points.yaml → point_to_sequence ===
        std::map<std::string, int> point_to_sequence;
        try
        {
            YAML::Node points_yaml = YAML::LoadFile(points_file_path);
            if (!points_yaml["points"] || !points_yaml["points"].IsSequence())
            {
                publish_status("Invalid points.yaml: missing 'points' sequence", "failure", 0);
                return BT::NodeStatus::FAILURE;
            }

            for (const auto &pt : points_yaml["points"])
            {
                if (pt["name"] && pt["sequence"])
                {
                    std::string name = pt["name"].as<std::string>();
                    int seq = pt["sequence"].as<int>();
                    point_to_sequence[name] = seq;
                }
            }
        }
        catch (const YAML::Exception &e)
        {
            RCLCPP_ERROR(node_->get_logger(), "points.yaml error: %s", e.what());
            publish_status("points.yaml parsing failed", "failure", 0);
            return BT::NodeStatus::FAILURE;
        }

        // === Load paths.yaml ===
        std::vector<std::string> path_names;
        std::vector<PathInfo> path_infos;

        try
        {
            YAML::Node yaml = YAML::LoadFile(input_file_path);
            if (!yaml["paths"] || !yaml["paths"].IsSequence())
            {
                publish_status("Invalid paths.yaml: missing 'paths' sequence", "failure", 0);
                return BT::NodeStatus::FAILURE;
            }

            for (const auto &path : yaml["paths"])
            {
                if (path["name"] && path["name"].IsScalar())
                {
                    std::string name = path["name"].as<std::string>();
                    path_names.push_back(name);

                    std::string start = (path["start_point"] && path["start_point"].IsScalar())
                                            ? path["start_point"].as<std::string>()
                                            : "";
                    std::string end = (path["end_point"] && path["end_point"].IsScalar())
                                          ? path["end_point"].as<std::string>()
                                          : "";

                    path_infos.push_back({name, start, end});
                }
            }

            if (path_names.empty())
            {
                publish_status("No valid path names found", "failure", 0);
                return BT::NodeStatus::FAILURE;
            }
        }
        catch (const YAML::Exception &e)
        {
            RCLCPP_ERROR(node_->get_logger(), "paths.yaml error: %s", e.what());
            publish_status("YAML parsing failed", "failure", 0);
            return BT::NodeStatus::FAILURE;
        }

        // === Generate XML ===
        tinyxml2::XMLDocument doc;
        doc.Parse("<root BTCPP_format=\"4\"></root>");
        auto *root = doc.FirstChildElement("root");
        if (!root)
        {
            publish_status("Failed to create XML root", "failure", 0);
            return BT::NodeStatus::FAILURE;
        }

        // complete_run_path
        auto *complete_tree = doc.NewElement("BehaviorTree");
        complete_tree->SetAttribute("ID", "complete_run_path");
        complete_tree->SetAttribute("name", ("complete_run_path_" + generate_random_suffix()).c_str());

        auto *root_seq = doc.NewElement("Sequence");
        root_seq->SetAttribute("ID", ("root_sequence_" + generate_random_suffix()).c_str());

        for (const auto &name : path_names)
            root_seq->InsertEndChild(create_path_sequence(doc, name));

        complete_tree->InsertEndChild(root_seq);
        root->InsertEndChild(complete_tree);

        // Individual BTs
        for (const auto &name : path_names)
        {
            auto *bt = doc.NewElement("BehaviorTree");
            bt->SetAttribute("ID", name.c_str());
            bt->SetAttribute("name", (name + "_" + generate_random_suffix()).c_str());

            auto *root_seq = doc.NewElement("Sequence");
            root_seq->SetAttribute("ID", ("root_sequence_" + generate_random_suffix()).c_str());
            root_seq->InsertEndChild(create_path_sequence(doc, name));

            bt->InsertEndChild(root_seq);
            root->InsertEndChild(bt);
        }

        // Group BTs
        generate_group_behavior_trees(path_infos, doc, root, point_to_sequence);

        // Save
        auto save_res = doc.SaveFile(xml_file_path.c_str());
        if (save_res != tinyxml2::XML_SUCCESS)
        {
            RCLCPP_ERROR(node_->get_logger(), "Failed to save XML: %d", save_res);
            publish_status("Failed to save XML", "failure", 0);
            return BT::NodeStatus::FAILURE;
        }

        RCLCPP_INFO(node_->get_logger(), "Generated XML with %zu paths", path_names.size());
        publish_status("XML Generated Successfully", "success", 10);
        return BT::NodeStatus::SUCCESS;
    }

    std::string AutoRunPathXml::generate_random_suffix()
    {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::uniform_int_distribution<> dis(1000, 9999);
        return std::to_string(dis(gen));
    }

    tinyxml2::XMLElement *AutoRunPathXml::create_path_sequence(tinyxml2::XMLDocument &doc, const std::string &path_name)
    {
        auto gen = [this]()
        { return generate_random_suffix(); };

        auto *seq = doc.NewElement("Sequence");
        seq->SetAttribute("ID", ("seq_" + path_name + "_" + gen()).c_str());

        auto *fallback = doc.NewElement("Fallback");
        fallback->SetAttribute("ID", ("fallback_" + gen()).c_str());

        auto *success_seq = doc.NewElement("Sequence");
        success_seq->SetAttribute("ID", ("seq_success_" + path_name + "_" + gen()).c_str());
        auto *run_path = doc.NewElement("RunPath");
        run_path->SetAttribute("path_name", path_name.c_str());
        run_path->SetAttribute("ID", (path_name + "_" + gen()).c_str());
        run_path->SetAttribute("speed_scale", "{desired_speed}");
        success_seq->InsertEndChild(run_path);
        auto *logger_success = doc.NewElement("MsgLogger");
        logger_success->SetAttribute("ID", ("msg_success_" + path_name + "_" + gen()).c_str());
        logger_success->SetAttribute("msg_log", (path_name + " success").c_str());
        success_seq->InsertEndChild(logger_success);

        auto *failure_seq = doc.NewElement("Sequence");
        failure_seq->SetAttribute("ID", ("seq_failure_" + path_name + "_" + gen()).c_str());
        auto *logger_fail = doc.NewElement("MsgLogger");
        logger_fail->SetAttribute("ID", ("msg_fail_" + path_name + "_" + gen()).c_str());
        logger_fail->SetAttribute("msg_log", (path_name + " failed").c_str());
        failure_seq->InsertEndChild(logger_fail);
        auto *popup = doc.NewElement("MsgPopup");
        popup->SetAttribute("ID", ("popup_" + path_name + "_" + gen()).c_str());
        popup->SetAttribute("msg", (path_name + " path failed").c_str());
        popup->SetAttribute("type", "failure");
        popup->SetAttribute("timeout", "0");
        failure_seq->InsertEndChild(popup);
        auto *always_fail = doc.NewElement("AlwaysFailure");
        failure_seq->InsertEndChild(always_fail);

        fallback->InsertEndChild(success_seq);
        fallback->InsertEndChild(failure_seq);
        seq->InsertEndChild(fallback);

        return seq;
    }

    void AutoRunPathXml::generate_group_behavior_trees(
        const std::vector<PathInfo> &paths,
        tinyxml2::XMLDocument &doc,
        tinyxml2::XMLElement *root,
        const std::map<std::string, int> &point_to_sequence)
    {
        if (paths.empty())
            return;

        std::map<int, std::vector<std::string>> groups;

        for (const auto &path : paths)
        {
            if (path.start_point.empty() || path.end_point.empty())
                continue;

            auto start_it = point_to_sequence.find(path.start_point);
            auto end_it = point_to_sequence.find(path.end_point);
            if (start_it == point_to_sequence.end() || end_it == point_to_sequence.end())
                continue;

            int max_seq = std::max(start_it->second, end_it->second);
            groups[max_seq].push_back(path.name);
        }

        int group_id = 1;
        for (const auto &[seq, path_list] : groups)
        {
            if (path_list.empty())
                continue;

            auto *group_bt = doc.NewElement("BehaviorTree");
            group_bt->SetAttribute("ID", ("group_" + std::to_string(group_id)).c_str());
            group_bt->SetAttribute("name", ("group_" + std::to_string(group_id) + "_" + generate_random_suffix()).c_str());

            auto *root_seq = doc.NewElement("Sequence");
            root_seq->SetAttribute("ID", ("root_sequence_" + generate_random_suffix()).c_str());

            for (const auto &name : path_list)
                root_seq->InsertEndChild(create_path_sequence(doc, name));

            group_bt->InsertEndChild(root_seq);
            root->InsertEndChild(group_bt);

            ++group_id;

            RCLCPP_INFO(node_->get_logger(), "Group %d (max_seq=%d): %zu paths", group_id - 1, seq, path_list.size());
        }
    }

    void AutoRunPathXml::publish_status(const std::string &message, const std::string &status, int timeout)
    {
        std_msgs::msg::String msg;
        std::stringstream ss;
        ss << message << "," << status << "," << timeout;
        msg.data = ss.str();
        status_pub_->publish(msg);
        RCLCPP_INFO(node_->get_logger(), "Published: %s", msg.data.c_str());
    }

} // namespace auto_run_path_xml