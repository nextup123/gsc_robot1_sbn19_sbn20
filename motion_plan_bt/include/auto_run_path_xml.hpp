/**
 * @file auto_run_path_xml.hpp
 * @author Adnan Alvi
 * @brief Behavior Tree node to generate run_path_tree.xml from paths.yaml and points.yaml
 * @version 1.0
 * @date 2025-11-01
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#ifndef AUTO_RUN_PATH_XML_HPP_
#define AUTO_RUN_PATH_XML_HPP_

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <yaml-cpp/yaml.h>
#include <tinyxml2.h>
#include <filesystem>
#include <vector>
#include <string>
#include <map>

namespace auto_run_path_xml
{

class AutoRunPathXml : public BT::SyncActionNode
{
public:
    AutoRunPathXml(
        const std::string& name,
        const BT::NodeConfiguration& config,
        const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;
    std::string input_file_path_;
    std::string xml_file_path_;
    std::string sequence_points_file_path;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;

    struct PathInfo
    {
        std::string name;
        std::string start_point;
        std::string end_point;
    };

    std::string generate_random_suffix();
    tinyxml2::XMLElement* create_path_sequence(tinyxml2::XMLDocument& doc, const std::string& path_name);
    void generate_group_behavior_trees(
        const std::vector<PathInfo>& paths,
        tinyxml2::XMLDocument& doc,
        tinyxml2::XMLElement* root,
        const std::map<std::string, int>& point_to_sequence);
    void publish_status(const std::string& message, const std::string& status, int timeout);
};

}  // namespace auto_run_path_xml

#endif  // AUTO_RUN_PATH_XML_HPP_