# 系统部署指南

> 当前可运行入口为本机仿真，硬件初始化和运动均禁用，Lua 驱动仅保留为参考。
> 以下实机部署说明是历史设计资料，不是可执行部署指南。必须先完成独立的硬件安全验证，不能依据本文启用实机。
> Web 服务固定监听 127.0.0.1；请勿开放 3000/1500 端口，也不要公开代理该服务。
> 急停不会自动解除。请检查系统后手动重启仿真；UI 安全复位按钮仅显示此提示。


> 协作机器人智能书写控制系统部署说明

## 📋 目录

- [系统要求](#系统要求)
- [环境准备](#环境准备)
- [系统安装](#系统安装)
- [配置说明](#配置说明)
- [启动与测试](#启动与测试)
- [故障排除](#故障排除)

## 💻 系统要求

### 硬件要求

| 组件 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | Intel i5 4代 | Intel i7 10代 |
| 内存 | 8GB | 16GB |
| 硬盘 | 50GB SSD | 100GB SSD |
| 网卡 | 千兆以太网 | 千兆以太网 |
| 显卡 | 集成显卡 | 独立显卡 |

### 软件要求

| 软件 | 版本 | 说明 |
|------|------|------|
| 操作系统 | Ubuntu 20.04 LTS | 64位桌面版 |
| Node.js | >= 14.0.0 | JavaScript运行时 |
| npm | >= 6.0.0 | 包管理器 |
| Git | >= 2.0.0 | 版本控制 |

### 网络要求

- **机器人控制柜**: 通过以太网连接到上位机
- **IP地址配置**: 
  - 上位机: 192.168.1.100/24
  - 机器人控制器: 192.168.1.101/24
- **本机端口**: 3000 (仿真 Web 服务)；无需开放入站端口

## 🔧 环境准备

### 1. 安装Ubuntu 20.04 LTS

#### 下载Ubuntu镜像
```bash
# 从官网下载
wget https://releases.ubuntu.com/20.04/ubuntu-20.04.6-desktop-amd64.iso
```

#### 制作启动U盘
```bash
# 使用dd命令 (Linux/Mac)
sudo dd if=ubuntu-20.04.6-desktop-amd64.iso of=/dev/sdX bs=4M status=progress

# 或使用Rufus (Windows)
# 下载: https://rufus.ie/
```

#### 安装系统
1. 从U盘启动
2. 选择"Install Ubuntu"
3. 按照向导完成安装
4. 更新系统
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. 安装Node.js

#### 使用NodeSource安装
```bash
# 添加NodeSource源
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# 安装Node.js
sudo apt install -y nodejs

# 验证安装
node --version
npm --version
```

#### 或使用nvm安装
```bash
# 安装nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 重新加载shell配置
source ~/.bashrc

# 安装Node.js
nvm install 18
nvm use 18
```

### 3. 安装Git

```bash
sudo apt install git
git --version
```

### 4. 安装EtherCAT Master (可选)

如果需要实机控制，安装IgH EtherCAT Master:

```bash
# 安装依赖
sudo apt install linux-headers-$(uname -r) build-essential

# 下载EtherCAT源码
cd /usr/src/
sudo git clone https://gitlab.com/etherlab.org/ethercat.git

# 编译安装
cd ethercat
sudo ./bootstrap
sudo ./configure --enable-8139too=no
sudo make
sudo make modules
sudo make install

# 配置EtherCAT
sudo mkdir /etc/sysconfig
sudo cp etc/sysconfig/ethercat /etc/sysconfig/
echo 'MASTER0_DEVICE="eth0"' | sudo tee -a /etc/sysconfig/ethercat
echo 'DEVICE_MODULES="generic"' | sudo tee -a /etc/sysconfig/ethercat

# 加载模块
sudo depmod
sudo modprobe ec_master
sudo modprobe ec_generic
```

## 📦 系统安装

### 1. 克隆项目

```bash
# 创建项目目录
sudo mkdir -p /opt/robot-control
cd /opt/robot-control

# 克隆项目代码
sudo git clone <repository-url> robot-arm-control-system
cd robot-arm-control-system
```

### 2. 安装项目依赖

```bash
# 安装npm依赖
npm install

# 或使用yarn (推荐)
npm install -g yarn
yarn install
```

### 3. 创建必要目录

```bash
# 创建运行时目录
sudo mkdir -p /var/log/robot-control
sudo mkdir -p /var/lib/robot-control
sudo mkdir -p /etc/robot-control

# 设置权限
sudo chown -R $USER:$USER /var/log/robot-control
sudo chown -R $USER:$USER /var/lib/robot-control
```

### 4. 配置网络

#### 配置静态IP
```bash
# 编辑网络配置
sudo nano /etc/netplan/01-netcfg.yaml

# 添加以下内容
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: no
      addresses: [192.168.1.100/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]

# 应用配置
sudo netplan apply
```

#### 测试连接
```bash
# 测试与机器人控制器的连接
ping 192.168.1.101

# 检查EtherCAT设备
sudo ethercat master
sudo ethercat slaves
```

## ⚙️ 配置说明

### 配置文件结构

```
config/
├── default.json          # 默认配置
├── production.json       # 生产环境配置
└── local.json           # 本地开发配置
```

### 主要配置项

#### 1. 服务器配置
```json
{
  "server": {
    "port": 3000,
    "host": "localhost",
    "cors": {
      "origin": "*",
      "methods": ["GET", "POST"]
    }
  }
}
```

#### 2. 机器人配置
```json
{
  "robot": {
    "model": "Estun-S3-60",
    "dof": 6,
    "limits": {
      "joints": [
        {"min": -170, "max": 170, "margin": 2},
        {"min": -130, "max": 130, "margin": 2}
      ]
    }
  }
}
```

#### 3. EtherCAT配置
```json
{
  "ethercat": {
    "vendorId": "0x00000666",
    "productCode": "0x00000001",
    "cycleTime": 10000,
    "timeout": 1000
  }
}
```

### 环境变量配置

创建 `.env` 文件:
```bash
# 服务器配置
NODE_ENV=production
PORT=3000
HOST=localhost

# 机器人配置
ROBOT_MODEL=Estun-S3-60
ROBOT_IP=192.168.1.101

# 日志配置
LOG_LEVEL=info
LOG_FILE=/var/log/robot-control/app.log

# 安全配置
SAFETY_ENABLED=true
COLLISION_THRESHOLD=15.0
```

## 🚀 启动与测试

### 1. 启动系统

```bash
# 进入项目目录
cd /opt/robot-control/robot-arm-control-system

# 启动应用
./start.sh

# 或开发模式
./start.sh --dev
```

### 2. 访问Web界面

打开浏览器访问: `http://localhost:3000`

### 3. 功能测试

#### 连接测试
```bash
# 检查WebSocket连接
npm run test:connection

# 检查EtherCAT通信
npm run test:ethercat
```

#### 关节控制测试
1. 点击"一键复位"按钮
2. 使用关节滑块控制J1-J6
3. 观察3D模型实时更新

#### 笛卡尔控制测试
1. 输入目标坐标 (X, Y, Z)
2. 点击"移动到目标点"
3. 验证末端位置精度

#### 智能书写测试
1. 输入测试文本 "SEU2025"
2. 设置字号20mm，速度20mm/s
3. 点击"开始书写"
4. 观察书写效果

### 4. 性能测试

```bash
# 通信频率测试
npm run test:performance

# 压力测试
npm run test:stress

# 安全测试
npm run test:safety
```

## 🔧 故障排除

### 1. 启动失败

**问题**: Node.js版本过低
```bash
# 解决方案: 升级Node.js
nvm install 18
nvm use 18
```

**问题**: 端口被占用
```bash
# 查找占用进程
sudo netstat -tlnp | grep 3000

# 终止进程
sudo kill -9 <PID>

# 或修改端口
export PORT=3001
```

### 2. EtherCAT通信失败

**问题**: 权限不足
```bash
# 添加用户到ethercat组
sudo usermod -a -G ethercat $USER

# 重新登录
su - $USER
```

**问题**: 设备未识别
```bash
# 检查设备
lsusb | grep EtherCAT
lsmod | grep ec_

# 重新加载模块
sudo modprobe ec_master
sudo modprobe ec_generic
```

### 3. 3D显示异常

**问题**: 浏览器不支持WebGL
```bash
# 解决方案: 使用Chrome或Firefox
# 启用WebGL: chrome://flags/#enable-webgl
```

**问题**: 显卡驱动问题
```bash
# 安装显卡驱动
sudo ubuntu-drivers autoinstall
```

### 4. 书写效果差

**问题**: 字迹模糊或断墨
```bash
# 调整参数
# 1. 降低书写速度
# 2. 增加笔尖压力
# 3. 校准工作平面
```

**问题**: 字形变形
```bash
# 检查逆运动学精度
# 重新标定机器人
```

## 📊 系统监控

### 1. 日志监控

```bash
# 实时查看日志
tail -f /var/log/robot-control/app.log
tail -f logs/combined.log

# 查看错误日志
tail -f logs/error.log
```

### 2. 性能监控

```bash
# CPU使用率
htop

# 内存使用率
free -h

# 网络流量
iftop
```

### 3. 系统状态

```bash
# 检查服务状态
systemctl status robot-control

# 检查进程
ps aux | grep node

# 检查端口
netstat -tlnp | grep 3000
```

## 🔄 系统更新

### 1. 代码更新

```bash
# 拉取最新代码
git pull origin main

# 重新安装依赖
npm install

# 重启服务
pm2 restart robot-control
```

### 2. 配置更新

```bash
# 备份原配置
cp config/production.json config/production.json.bak

# 编辑新配置
nano config/production.json

# 重启应用
npm restart
```

## 📦 备份与恢复

### 1. 数据备份

```bash
# 创建备份目录
mkdir -p /backup/robot-control

# 备份配置
cp -r config/ /backup/robot-control/

# 备份日志
cp -r logs/ /backup/robot-control/

# 备份数据
cp -r data/ /backup/robot-control/
```

### 2. 系统恢复

```bash
# 恢复配置
cp -r /backup/robot-control/config/* config/

# 恢复数据
cp -r /backup/robot-control/data/* data/

# 重启应用
npm start
```

## 🔐 安全加固

### 1. 防火墙配置

```bash
# 安装UFW
sudo apt install ufw

# 配置规则
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw enable
```

### 2. 用户权限

```bash
# 创建专用用户
sudo useradd -m -s /bin/bash robot-control
sudo usermod -a -G dialout robot-control
sudo usermod -a -G ethercat robot-control

# 设置权限
sudo chown -R robot-control:robot-control /opt/robot-control
```

### 3. SSL证书

```bash
# 安装Certbot
sudo apt install certbot

# 生成证书
sudo certbot certonly --standalone -d yourdomain.com
```

## 🆘 技术支持

### 获取帮助

1. **查看文档**: [docs/README.md](README.md)
2. **提交Issue**: [GitHub Issues](https://github.com/your-repo/issues)
3. **邮件支持**: support@your-domain.com
4. **在线文档**: https://your-docs-url.com

### 诊断工具

```bash
# 系统诊断脚本
./scripts/diagnose.sh

# 性能分析
./scripts/performance.sh

# 安全检查
./scripts/security-check.sh
```

---

**注意**: 本部署指南基于Ubuntu 20.04 LTS，其他Linux发行版可能需要相应调整。