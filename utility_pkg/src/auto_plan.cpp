#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/bool.hpp>
#include <yaml-cpp/yaml.h>
#include <tinyxml2.h>
#include <filesystem>
#include <vector>
#include <sstream>
#include <map>
#include <set>
#include <algorithm>

namespace auto_plan_node
{

  class AutoPlanNode : public rclcpp::Node
  {
  public:
    AutoPlanNode()
        : Node("auto_plan_node")
    {
      this->declare_parameter<std::string>("input_file_path", "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");
      this->declare_parameter<std::string>("xml_file_path", "/home/nextup/NextupRobot/src/active_project_configs/planning_data/plan_path.xml");
      RCLCPP_INFO(this->get_logger(), "AutoPlanNode initialized");

      status_pub_ = this->create_publisher<std_msgs::msg::String>("/bt_toast_popup", 10);
      auto_plan_sub_ = this->create_subscription<std_msgs::msg::String>(
          "/auto_plan_sequence", 10,
          std::bind(&AutoPlanNode::auto_plan_callback, this, std::placeholders::_1));

      RCLCPP_INFO(this->get_logger(), "Waiting for /auto_plan_sequence message to start planning...");
    }

  private:
    void auto_plan_callback(const std_msgs::msg::String::SharedPtr msg)
    {
      RCLCPP_INFO(this->get_logger(), "Received /auto_plan_sequence = %s", msg->data.c_str());

      if (msg->data == "default")
      {
        execute_default_planning();
        return;
      }

      std::string input = msg->data;
      std::vector<std::vector<int>> parts_order;
      std::stringstream ss(input);
      std::string part;
      while (std::getline(ss, part, '&'))
      {
        std::vector<int> part_seq;
        parse_sequence(part, part_seq);
        if (part_seq.empty())
        {
          publish_status("Empty sequence order in part", "failure", 0);
          return;
        }
        parts_order.push_back(part_seq);
      }

      if (parts_order.empty())
      {
        publish_status("No valid parts found", "failure", 0);
        return;
      }

      execute_planning(parts_order);
    }

    void parse_sequence(const std::string& str, std::vector<int>& order)
    {
      order.clear();
      std::stringstream ss(str);
      std::string item;
      try
      {
        while (std::getline(ss, item, ','))
        {
          order.push_back(std::stoi(item));
        }
      }
      catch (const std::exception& e)
      {
        RCLCPP_ERROR(this->get_logger(), "Parse error: %s", e.what());
      }
    }

    tinyxml2::XMLElement* find_root_plan_sequence(tinyxml2::XMLElement* element)
    {
      if (!element) return nullptr;
      const char* name = element->Name();
      const char* attr_name = element->Attribute("name");
      if (name && attr_name && std::string(name) == "Sequence" && std::string(attr_name) == "root_plan_sequence")
        return element;
      for (tinyxml2::XMLElement* child = element->FirstChildElement(); child; child = child->NextSiblingElement())
      {
        auto found = find_root_plan_sequence(child);
        if (found) return found;
      }
      return nullptr;
    }

    void execute_default_planning()
    {
      std::string input_file_path, xml_file_path;
      if (!this->get_parameter("input_file_path", input_file_path) || input_file_path.empty() ||
          !this->get_parameter("xml_file_path", xml_file_path) || xml_file_path.empty())
      {
        publish_status("Missing parameters", "failure", 0);
        return;
      }

      try
      {
        if (!std::filesystem::exists(input_file_path))
        {
          publish_status("YAML file not found", "failure", 0);
          return;
        }

        YAML::Node yaml = YAML::LoadFile(input_file_path);
        std::vector<std::string> point_names;
        if (yaml["points"])
        {
          for (const auto& point : yaml["points"])
          {
            if (point["name"]) point_names.push_back(point["name"].as<std::string>());
          }
        }
        if (point_names.size() < 2)
        {
          publish_status("Not enough points", "failure", 0);
          return;
        }

        std::vector<std::string> point_pairs;
        for (size_t i = 0; i < point_names.size() - 1; ++i)
          point_pairs.push_back(point_names[i] + "_" + point_names[i + 1]);

        generate_xml(point_pairs, xml_file_path);
      }
      catch (const YAML::Exception& e)
      {
        // RCLCPP_ERROR(this->get_logger(), "YAML error: %s", e.what());
        publish_status("YAML error", "failure", 0);
      }
    }

    void execute_planning(const std::vector<std::vector<int>>& parts_order)
    {
      std::string input_file_path, xml_file_path;
      if (!this->get_parameter("input_file_path", input_file_path) || input_file_path.empty() ||
          !this->get_parameter("xml_file_path", xml_file_path) || xml_file_path.empty())
      {
        publish_status("Missing parameters", "failure", 0);
        return;
      }

      try
      {
        if (!std::filesystem::exists(input_file_path))
        {
          publish_status("YAML file not found", "failure", 0);
          return;
        }

        YAML::Node yaml = YAML::LoadFile(input_file_path);
        std::map<int, std::vector<std::string>> sequence_groups;
        if (yaml["points"])
        {
          for (const auto& point : yaml["points"])
          {
            if (point["name"] && point["sequence"])
            {
              int seq = point["sequence"].as<int>();
              sequence_groups[seq].push_back(point["name"].as<std::string>());
            }
          }
        }

        // Validate all sequences across all parts
        for (size_t i = 0; i < parts_order.size(); ++i)
        {
          const auto& part = parts_order[i];
          for (int seq : part)
          {
            if (sequence_groups.find(seq) == sequence_groups.end() || sequence_groups[seq].empty())
            {
              // RCLCPP_ERROR(this->get_logger(), "Sequence %d not found in part %zu", seq, i + 1);
              publish_status("Sequence not found", "failure", 0);
              return;
            }
          }
        }

        // Process all parts, preserving order
        std::vector<std::string> point_pairs;
        std::set<int> processed_sequences;

        for (size_t part_idx = 0; part_idx < parts_order.size(); ++part_idx)
        {
          const auto& part_order = parts_order[part_idx];
          std::set<int> processed_in_part;

          for (size_t i = 0; i < part_order.size(); ++i)
          {
            int seq = part_order[i];
            const auto& points = sequence_groups[seq];

            // Intra-sequence pairs only if sequence hasn't been processed in any part
            if (processed_sequences.find(seq) == processed_sequences.end() &&
                processed_in_part.find(seq) == processed_in_part.end())
            {
              for (size_t j = 0; j < points.size() - 1; ++j)
              {
                point_pairs.push_back(points[j] + "_" + points[j + 1]);
              }
              processed_in_part.insert(seq);
              processed_sequences.insert(seq);
            }

            // Inter-sequence pairs
            if (i < part_order.size() - 1)
            {
              int next_seq = part_order[i + 1];
              std::string start = points.back();
              std::string goal = (next_seq == 1) ? sequence_groups[next_seq].back() : sequence_groups[next_seq].front();
              point_pairs.push_back(start + "_" + goal);
            }
          }
        }

        // Remove duplicates while preserving order
        std::vector<std::string> unique_point_pairs;
        std::set<std::string> seen_pairs;
        for (const auto& pair : point_pairs)
        {
          if (seen_pairs.find(pair) == seen_pairs.end())
          {
            unique_point_pairs.push_back(pair);
            seen_pairs.insert(pair);
          }
        }

        if (unique_point_pairs.empty())
        {
          publish_status("No pairs generated", "failure", 0);
          return;
        }

        generate_xml(unique_point_pairs, xml_file_path);
      }
      catch (const YAML::Exception& e)
      {
        RCLCPP_ERROR(this->get_logger(), "YAML error: %s", e.what());
        publish_status("YAML error", "failure", 0);
      }
    }

    void generate_xml(const std::vector<std::string>& point_pairs, const std::string& xml_file_path)
    {
      tinyxml2::XMLDocument doc;
      auto load_res = doc.LoadFile(xml_file_path.c_str());
      if (load_res != tinyxml2::XML_SUCCESS)
      {
        // RCLCPP_ERROR(this->get_logger(), "Failed to load XML: %d", load_res);
        publish_status("Failed to load XML", "failure", 0);
        return;
      }

      auto* root_plan_sequence = find_root_plan_sequence(doc.RootElement());
      if (!root_plan_sequence)
      {
        publish_status("root_plan_sequence not found", "failure", 0);
        return;
      }

      if (!root_plan_sequence->FirstChildElement())
      {
        auto* parent = root_plan_sequence->Parent()->ToElement();
        if (!parent)
        {
          publish_status("no parent", "failure", 0);
          return;
        }
        auto* previous = root_plan_sequence->PreviousSiblingElement();
        parent->DeleteChild(root_plan_sequence);
        root_plan_sequence = doc.NewElement("Sequence");
        root_plan_sequence->SetAttribute("name", "root_plan_sequence");
        if (previous) parent->InsertAfterChild(previous, root_plan_sequence);
        else parent->InsertFirstChild(root_plan_sequence);
      }
      else
      {
        root_plan_sequence->DeleteChildren();
      }

      for (const auto& pair : point_pairs)
      {
        size_t pos = pair.find('_');
        std::string start = pair.substr(0, pos);
        std::string goal = pair.substr(pos + 1);
        std::string path_name = pair;

        auto* plan_sequence = doc.NewElement("Sequence");
        plan_sequence->SetAttribute("name", ("plan_" + path_name).c_str());
        auto* fallback = doc.NewElement("Fallback");
        auto* success_seq = doc.NewElement("Sequence");
        auto* init_seq = doc.NewElement("Sequence");

        auto* logger1 = doc.NewElement("MsgLoggerNode");
        logger1->SetAttribute("msg_log", ("[MOTION-PLAN] Initiating cartesian-space path planning: start=" + start + ", goal=" + goal + ", path=" + path_name).c_str());
        init_seq->InsertEndChild(logger1);
        auto* popup1 = doc.NewElement("PopupMsg");
        popup1->SetAttribute("msg", ("Planning Path: " + start + " to " + goal).c_str());
        popup1->SetAttribute("type", "warn");
        popup1->SetAttribute("timeout", "10");
        init_seq->InsertEndChild(popup1);
        success_seq->InsertEndChild(init_seq);

        auto* plan_path = doc.NewElement("PlanPath");
        plan_path->SetAttribute("start_goal", start.c_str());
        plan_path->SetAttribute("end_goal", goal.c_str());
        plan_path->SetAttribute("plan_space", "cartesian");
        plan_path->SetAttribute("path_name", path_name.c_str());
        success_seq->InsertEndChild(plan_path);

        auto* logger2 = doc.NewElement("MsgLoggerNode");
        logger2->SetAttribute("msg_log", ("[MOTION-PLAN] Successfully planned: start=" + start + ", goal=" + goal).c_str());
        success_seq->InsertEndChild(logger2);
        auto* popup2 = doc.NewElement("PopupMsg");
        popup2->SetAttribute("msg", ("Path Planning Successful: " + start + " to " + goal).c_str());
        popup2->SetAttribute("type", "success");
        popup2->SetAttribute("timeout", "10");
        success_seq->InsertEndChild(popup2);
        auto* sleep = doc.NewElement("Sleep");
        sleep->SetAttribute("msec", "300");
        success_seq->InsertEndChild(sleep);

        fallback->InsertEndChild(success_seq);

        auto* failure_seq = doc.NewElement("Sequence");
        auto* fail_report = doc.NewElement("Sequence");
        auto* logger3 = doc.NewElement("MsgLoggerNode");
        logger3->SetAttribute("msg_log", ("[MOTION-PLAN] Path planning FAILED: start=" + start + ", goal=" + goal).c_str());
        fail_report->InsertEndChild(logger3);
        auto* popup3 = doc.NewElement("PopupMsg");
        popup3->SetAttribute("msg", ("Path Planning Failed: " + start + " to " + goal).c_str());
        popup3->SetAttribute("type", "failure");
        popup3->SetAttribute("timeout", "0");
        fail_report->InsertEndChild(popup3);
        failure_seq->InsertEndChild(fail_report);

        auto* shutdown_seq = doc.NewElement("Sequence");
        auto* logger4 = doc.NewElement("MsgLoggerNode");
        logger4->SetAttribute("msg_log", "[MOTION-PLAN] Shutting down motion planning node due to planning failure.");
        shutdown_seq->InsertEndChild(logger4);
        failure_seq->InsertEndChild(shutdown_seq);

        auto* shutdown = doc.NewElement("ShutdownNode");
        failure_seq->InsertEndChild(shutdown);
        auto* logger5 = doc.NewElement("MsgLoggerNode");
        logger5->SetAttribute("msg_log", "[MOTION-PLAN] Please review the planning parameters/control flow and restart motion planning.");
        failure_seq->InsertEndChild(logger5);
        auto* publish = doc.NewElement("PublishDataOnTopic");
        publish->SetAttribute("type_of_topic", "std_msgs/msg/String");
        publish->SetAttribute("msg_on_topic", "stop");
        publish->SetAttribute("topic_name", "/control_process_motion_bt");
        failure_seq->InsertEndChild(publish);
        auto* always_fail = doc.NewElement("AlwaysFailure");
        failure_seq->InsertEndChild(always_fail);

        fallback->InsertEndChild(failure_seq);
        plan_sequence->InsertEndChild(fallback);
        root_plan_sequence->InsertEndChild(plan_sequence);
      }

      auto save_res = doc.SaveFile(xml_file_path.c_str());
      if (save_res != tinyxml2::XML_SUCCESS)
      {
        // RCLCPP_ERROR(this->get_logger(), "Failed to save XML: %d", save_res);
        publish_status("Failed to save XML", "failure", 0);
        return;
      }

      // RCLCPP_INFO(this->get_logger(), "Generated %zu pairs", point_pairs.size());
      publish_status("Success", "success", 10);
    }

    void publish_status(const std::string& message, const std::string& status, int timeout)
    {
      std_msgs::msg::String msg;
      std::stringstream ss;
      ss << message << "," << status << "," << timeout;
      msg.data = ss.str();
      status_pub_->publish(msg);
      // RCLCPP_INFO(this->get_logger(), "Published: %s", msg.data.c_str());
    }

    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;
    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr auto_plan_sub_;
  };

} // namespace auto_plan_node

int main(int argc, char** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<auto_plan_node::AutoPlanNode>());
  rclcpp::shutdown();
  return 0;
}