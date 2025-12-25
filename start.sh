#!/bin/bash

# 协作机器人智能书写控制系统启动脚本
# Robot Arm Intelligent Handwriting Control System Startup Script

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目信息
PROJECT_NAME="协作机器人智能书写控制系统"
PROJECT_VERSION="1.0.0"
NODE_VERSION_REQUIRED="14.0.0"

# 打印标题
print_header() {
    echo -e "${BLUE}"
    echo "======================================================"
    echo "         协作机器人智能书写控制系统"
    echo "    Collaborative Robot Intelligent Handwriting"
    echo "           Control System v1.0.0"
    echo "======================================================"
    echo -e "${NC}"
}

# 检查Node.js版本
check_node_version() {
    echo -e "${YELLOW}正在检查Node.js版本...${NC}"
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}错误: 未找到Node.js${NC}"
        echo -e "${YELLOW}请先安装Node.js ${NODE_VERSION_REQUIRED} 或更高版本${NC}"
        exit 1
    fi
    
    CURRENT_VERSION=$(node -v | cut -d'v' -f2)
    REQUIRED_VERSION=$NODE_VERSION_REQUIRED
    
    if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$CURRENT_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
        echo -e "${RED}错误: Node.js版本过低${NC}"
        echo -e "${YELLOW}当前版本: ${CURRENT_VERSION}${NC}"
        echo -e "${YELLOW}要求版本: ${REQUIRED_VERSION} 或更高${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Node.js版本检查通过: ${CURRENT_VERSION}${NC}"
}

# 检查依赖
check_dependencies() {
    echo -e "${YELLOW}正在检查项目依赖...${NC}"
    
    if [ ! -f "package.json" ]; then
        echo -e "${RED}错误: 未找到package.json文件${NC}"
        exit 1
    fi
    
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}检测到首次运行，正在安装依赖...${NC}"
        npm install
        echo -e "${GREEN}✓ 依赖安装完成${NC}"
    else
        echo -e "${GREEN}✓ 依赖已安装${NC}"
    fi
}

# 创建必要的目录
create_directories() {
    echo -e "${YELLOW}正在创建必要的目录...${NC}"
    
    mkdir -p logs
    mkdir -p data
    mkdir -p config
    mkdir -p uploads
    mkdir -p temp
    
    echo -e "${GREEN}✓ 目录创建完成${NC}"
}

# 检查EtherCAT权限
check_ethercat_permissions() {
    echo -e "${YELLOW}正在检查EtherCAT权限...${NC}"
    
    if [ -e "/dev/EtherCAT0" ]; then
        if [ ! -r "/dev/EtherCAT0" ] || [ ! -w "/dev/EtherCAT0" ]; then
            echo -e "${YELLOW}警告: EtherCAT设备权限不足${NC}"
            echo -e "${YELLOW}请运行以下命令添加权限:${NC}"
            echo -e "${BLUE}sudo usermod -a -G ethercat $USER${NC}"
            echo -e "${YELLOW}然后重新登录系统${NC}"
            echo -e "${YELLOW}或使用以下命令临时授权:${NC}"
            echo -e "${BLUE}sudo chmod 666 /dev/EtherCAT0${NC}"
        else
            echo -e "${GREEN}✓ EtherCAT权限正常${NC}"
        fi
    else
        echo -e "${YELLOW}警告: 未检测到EtherCAT设备${NC}"
        echo -e "${YELLOW}系统将以仿真模式运行${NC}"
    fi
}

# 设置环境变量
setup_environment() {
    echo -e "${YELLOW}正在设置环境变量...${NC}"
    
    export NODE_ENV=production
    export PORT=3000
    
    # 检查是否为root用户
    if [ "$EUID" -eq 0 ]; then
        echo -e "${YELLOW}警告: 以root用户运行可能存在安全风险${NC}"
    fi
    
    echo -e "${GREEN}✓ 环境变量设置完成${NC}"
}

# 启动应用
start_application() {
    echo -e "${YELLOW}正在启动应用...${NC}"
    echo -e "${BLUE}"
    echo "======================================================"
    echo "  应用启动后，请打开浏览器访问: http://localhost:3000"
    echo "  按 Ctrl+C 停止应用"
    echo "======================================================"
    echo -e "${NC}"
    
    # 使用nodemon进行开发，node进行生产
    if command -v nodemon &> /dev/null && [ "$1" = "--dev" ]; then
        echo -e "${YELLOW}使用 nodemon 启动 (开发模式)${NC}"
        nodemon backend/server.js
    else
        echo -e "${YELLOW}使用 node 启动 (生产模式)${NC}"
        node backend/server.js
    fi
}

# 显示使用说明
show_usage() {
    echo "使用方法:"
    echo "  ./start.sh           # 生产模式启动"
    echo "  ./start.sh --dev     # 开发模式启动 (使用nodemon)"
    echo "  ./start.sh --help    # 显示帮助信息"
    echo ""
    echo "选项:"
    echo "  --dev     开发模式，支持热重载"
    echo "  --help    显示帮助信息"
    echo ""
    echo "环境变量:"
    echo "  NODE_ENV  设置运行环境 (development/production)"
    echo "  PORT      设置服务端口 (默认: 3000)"
}

# 主函数
main() {
    print_header
    
    # 检查参数
    if [ "$1" = "--help" ]; then
        show_usage
        exit 0
    fi
    
    # 检查系统
    if [ "$(uname -s)" != "Linux" ]; then
        echo -e "${YELLOW}警告: 当前系统不是Linux，某些功能可能无法正常使用${NC}"
    fi
    
    # 执行检查
    check_node_version
    check_dependencies
    create_directories
    check_ethercat_permissions
    setup_environment
    
    # 启动应用
    start_application "$@"
}

# 捕获中断信号
trap 'echo -e "\n${RED}收到中断信号，正在退出...${NC}"; exit 0' INT TERM

# 执行主函数
main "$@"