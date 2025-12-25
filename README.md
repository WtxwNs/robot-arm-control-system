# 协作机器人智能书写控制系统

> 基于开放式上位机的协作机器人智能书写控制系统研究与实现
> 
> Collaborative Robot Intelligent Handwriting Control System

[![Node.js](https://img.shields.io/badge/Node.js-14.0+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux-orange.svg)](https://www.linux.org/)

## 📋 项目简介

本项目是一套基于开放式上位机架构的协作机器人智能书写控制系统，绕过传统工业机器人封闭的控制器，通过在Ubuntu Linux环境下自主开发的全栈软件，实现对机器人底层运动的直接、灵活控制。

### 核心特性

- ✅ **开放式架构**：基于Node.js + WebSocket + EtherCAT技术栈
- 🤖 **六轴控制**：完整的六自由度机械臂运动控制
- ✍️ **智能书写**：从文本输入到物理轨迹的自动生成与执行
- 🛡️ **安全监控**：多级安全防护体系，实时状态监控
- 🎮 **友好界面**：现代化的Web界面，3D可视化监控
- 📊 **实时通信**：100Hz高频控制，端到端延迟<200ms

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        上位机 (PC)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Web界面    │  │  运动规划器  │  │  安全监控器  │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │
│  ┌──────┴────────────────┴────────────────┴──────┐        │
│  │              WebSocket服务器                   │        │
│  │              (Node.js + Socket.IO)            │        │
│  └──────┬────────────────┬──────┬───────────────┘        │
│         │                │      │                        │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐       │
│  │  运动学计算  │  │  轨迹生成   │  │  字库解析   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ EtherCAT
                            │
┌─────────────────────────────────────────────────────────────┐
│                      下位机 (控制柜)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  EtherCAT   │  │  伺服驱动   │  │  机器人本体  │        │
│  │  从站接口   │  │  控制器     │  │  (6-DOF)    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 环境要求

- **操作系统**: Ubuntu 20.04 LTS (推荐)
- **Node.js**: >= 14.0.0
- **npm**: >= 6.0.0
- **EtherCAT**: 需要IgH EtherCAT Master (可选，用于实机控制)

### 安装步骤

1. **克隆项目**
```bash
cd /opt/
sudo git clone <repository-url> robot-arm-control-system
cd robot-arm-control-system
```

2. **安装依赖**
```bash
npm install
```

3. **启动系统**
```bash
# 生产模式
./start.sh

# 开发模式 (支持热重载)
./start.sh --dev
```

4. **访问界面**
打开浏览器访问: `http://localhost:3000`

## 📁 项目结构

```
robot-arm-control-system/
├── backend/                    # 后端代码
│   ├── server.js              # 主服务器
│   └── controllers/           # 控制器模块
│       ├── RobotController.js # 机器人控制器
│       ├── Kinematics.js      # 运动学算法
│       ├── MotionPlanner.js   # 轨迹规划器
│       ├── HandwritingEngine.js # 智能书写引擎
│       └── SafetyMonitor.js   # 安全监控器
├── frontend/                  # 前端代码
│   ├── index.html            # 主页面
│   ├── styles.css            # 样式表
│   └── app.js                # 前端应用
├── config/                   # 配置文件
│   └── default.json          # 默认配置
├── logs/                     # 日志目录
├── package.json              # 项目依赖
├── start.sh                  # 启动脚本
└── README.md                 # 项目说明
```

## 🎮 功能说明

### 1. 快速操作

- **一键复位**: 无论机器人当前处于何种位姿，自动规划平滑路径返回零位
- **紧急停止**: 立即停止所有运动，确保系统安全
- **安全复位**: 重置安全系统状态

### 2. 关节控制

- **滑块控制**: 拖拽滑块控制单个关节角度
- **点动控制**: ±0.1°精度的步进调整
- **实时反馈**: 实时显示关节角度和状态
- **限位保护**: 软件限位，防止超出物理范围

### 3. 笛卡尔控制

- **坐标输入**: 直接输入目标位置(X, Y, Z)和姿态(Rx, Ry, Rz)
- **点动按钮**: 快速±10mm步进移动
- **逆运动学**: 自动计算最优关节角度解
- **奇异点检测**: 避免机器人进入奇异位形

### 4. 智能书写

- **文本输入**: 支持英文字母和数字
- **参数调节**: 字号、书写速度可调
- **轨迹生成**: 自动解析矢量字库，生成三维书写轨迹
- **抬笔控制**: 自动插入抬笔/落笔指令

### 5. 3D可视化

- **实时显示**: 机器人当前姿态实时渲染
- **多视角切换**: 正视、俯视、侧视等多种视角
- **网格参考**: 便于判断位置和距离
- **阴影效果**: 增强立体感

### 6. 状态监控

- **关节角度**: 实时显示6个关节的角度值
- **末端位置**: 显示末端执行器的三维坐标
- **通信频率**: 实时通信频率监控
- **系统日志**: 操作记录和错误提示

## 🔧 核心算法

### 1. 运动学算法

**正向运动学**: 基于改进型DH参数法，计算给定关节角下的末端位姿

```javascript
// 齐次变换矩阵
T(i-1, i) = Rot(x, α) · Trans(x, a) · Rot(z, θ) · Trans(z, d)

// 正运动学连乘
T_total = T01 · T12 · T23 · T34 · T45 · T56
```

**逆向运动学**: 解析法与数值迭代结合，支持多解优选

### 2. 轨迹规划算法

**五次多项式插值**: 实现位置、速度、加速度的连续平滑

```javascript
q(t) = c₀ + c₁t + c₂t² + c₃t³ + c₄t⁴ + c₅t⁵

// 边界条件
q(0) = q0,  q(tf) = qf
q'(0) = 0,  q'(tf) = 0
q''(0) = 0, q''(tf) = 0
```

**S曲线加减速**: 抑制机械振动，保护减速机

### 3. 智能书写算法

**矢量字库解析**: 解析Hershey矢量字库，提取字符轮廓

**仿射变换**: 将二维字符坐标映射到三维工作空间

```javascript
⎡ x ⎤   ⎡ s·cosφ  -s·sinφ   0 ⎤   ⎡ u ⎤   ⎡ x₀ ⎤
⎢ y ⎥ = ⎢ s·sinφ   s·cosφ   0 ⎥ · ⎢ v ⎥ + ⎢ y₀ ⎥
⎣ z ⎦   ⎣   0        0      1 ⎦   ⎣ 0 ⎦   ⎣ z_paper ⎦
```

## 🛡️ 安全设计

### 多级安全防护体系

1. **硬件级**: 物理急停按钮，直接切断伺服电源
2. **控制器级**: 碰撞检测功能，力矩突变时自动停止
3. **软件级**: 
   - 软件限速锁 (末端线速度 ≤ 250mm/s)
   - 关节限位保护
   - 工作空间边界检查
   - 心跳看门狗机制

### 安全指标

- **急停响应时间**: ≤ 50ms
- **软限位保护**: 距离物理极限2°时100%有效
- **碰撞检测灵敏度**: 80%
- **通信中断保护**: 超过100ms自动降速停车

## 📊 性能指标

### 系统性能

| 指标 | 目标值 | 实测值 |
|------|--------|--------|
| 通信频率 | ≥ 100 Hz | 100 Hz |
| 端到端延迟 | ≤ 200 ms | < 150 ms |
| 逆运动学精度 | ≤ 0.5 mm | < 0.3 mm |
| 轨迹跟随精度 | ≤ 1.5 mm | < 1.0 mm |
| 急停响应时间 | ≤ 50 ms | < 30 ms |

### 书写质量

| 指标 | 目标值 | 实测值 |
|------|--------|--------|
| 字高误差 | < 1 mm | < 0.5 mm |
| 笔画清晰度 | 无断墨 | 优秀 |
| 书写速度 | 20±5 mm/s | 20 mm/s |
| 笔尖压力控制 | ±0.2 mm | ±0.1 mm |

## 🔌 EtherCAT配置

### 安装IgH EtherCAT Master

```bash
# Ubuntu 20.04
sudo apt update
sudo apt install ethercat-master

# 配置EtherCAT
sudo nano /etc/ethercat.conf
```

### 设备权限

```bash
# 添加用户到ethercat组
sudo usermod -a -G ethercat $USER

# 或临时授权
sudo chmod 666 /dev/EtherCAT0
```

## 🐛 故障排除

### 常见问题

**1. WebSocket连接失败**
- 检查Node.js服务是否启动
- 检查防火墙设置
- 确认端口未被占用

**2. EtherCAT通信失败**
- 检查物理连接
- 确认设备权限
- 检查EtherCAT Master状态

**3. 机器人不响应**
- 检查急停按钮状态
- 确认安全系统正常
- 查看系统日志

**4. 书写效果不佳**
- 调整笔尖压力
- 优化书写速度
- 校准工作平面

### 调试工具

```bash
# 查看系统日志
tail -f logs/combined.log

# 检查EtherCAT状态
ethercat master
ethercat slaves

# 网络调试
ping 192.168.101.100
netstat -tlnp | grep 3000
```

## 📖 API接口

### WebSocket事件

**发送指令**
```javascript
// 关节运动
socket.emit('joint-move', { jointIndex, angle, speed });

// 笛卡尔运动
socket.emit('cartesian-move', { x, y, z, rx, ry, rz, speed });

// 一键复位
socket.emit('home-reset', { speed });

// 智能书写
socket.emit('handwriting-start', { text, fontSize, speed });

// 紧急停止
socket.emit('emergency-stop');
```

**接收状态**
```javascript
// 状态更新
socket.on('robot-status-update', (status) => {
    console.log('机器人状态:', status);
});

// 操作反馈
socket.on('joint-move-success', (data) => {
    console.log('关节移动成功:', data);
});
```

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

### 开发流程

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

### 代码规范

- 使用ES6+语法
- 遵循Airbnb JavaScript Style Guide
- 添加完整的JSDoc注释
- 编写单元测试

## 📄 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- **东南大学未来技术学院** - 项目支持
- **埃斯顿自动化** - 机器人平台支持
- **Node.js社区** - 开源技术支持
- **Three.js社区** - 3D可视化支持

## 📞 联系方式

- **项目团队**: School of Future Technology, Southeast University, Nanjing, China
- **指导教师**: 甘亚辉
- **开发团队**: 关皓元、侯强、洪灏维、徐韵洁、季书宝、王童曦（corresponding author）

---

**注意**: 本项目仅供教育和研究使用，请勿用于商业用途。
