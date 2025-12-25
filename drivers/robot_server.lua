--[[
 * 埃斯顿协作机器人 EtherCAT 通信脚本
 * Estun Collaborative Robot EtherCAT Communication Script
 * 
 * 功能:
 * - EtherCAT 从站通信
 * - 关节伺服控制
 * - TCP Socket 监听
 * - 指令解析与执行
 * 
 * 作者: SEU Future Technology College
 * 版本: 1.0.0
]]

-- 全局配置
local CONFIG = {
    -- EtherCAT 配置
    ethercat = {
        vendorId = 0x00000666,    -- 埃斯顿厂商ID
        productCode = 0x00000001, -- 产品代码
        cycleTime = 10000,        -- 周期时间(us)
        timeout = 1000           -- 超时时间(ms)
    },
    
    -- Socket 配置
    socket = {
        port = 1500,              -- 监听端口
        maxConnections = 5,       -- 最大连接数
        bufferSize = 1024         -- 缓冲区大小
    },
    
    -- 机器人配置
    robot = {
        dof = 6,                  -- 自由度
        jointLimits = {           -- 关节限位(度)
            {min = -170, max = 170},
            {min = -130, max = 130},
            {min = -170, max = 170},
            {min = -175, max = 175},
            {min = -130, max = 130},
            {min = -360, max = 360}
        },
        maxVelocity = {           -- 最大速度(度/s)
            120, 120, 120, 240, 240, 360
        },
        maxAcceleration = {       -- 最大加速度(度/s²)
            480, 480, 480, 960, 960, 1440
        }
    },
    
    -- 安全配置
    safety = {
        enableCollisionDetection = true,
        collisionThreshold = 15.0,  -- 碰撞电流阈值(A)
        emergencyStopDelay = 50,    -- 急停延迟(ms)
        positionTolerance = 0.1     -- 位置容差(度)
    }
}

-- EtherCAT 通信类
local EtherCATMaster = {
    slaves = {},
    isConnected = false,
    cycleCounter = 0
}

-- 初始化EtherCAT主站
function EtherCATMaster:initialize()
    print("[EtherCAT] 初始化主站...")
    
    -- 配置EtherCAT主站
    local result = ecrt.request_master()
    if result ~= 0 then
        print("[EtherCAT] 主站初始化失败: " .. result)
        return false
    end
    
    -- 配置从站
    for i = 1, CONFIG.robot.dof do
        local slave_config = {
            alias = 0,
            position = i - 1,
            vendor_id = CONFIG.ethercat.vendorId,
            product_code = CONFIG.ethercat.productCode
        }
        
        self.slaves[i] = ecrt.create_slave(slave_config)
        if not self.slaves[i] then
            print("[EtherCAT] 从站 " .. i .. " 配置失败")
            return false
        end
        
        -- 配置PDO映射
        self:configurePDO(self.slaves[i])
    end
    
    -- 启动主站
    result = ecrt.activate()
    if result ~= 0 then
        print("[EtherCAT] 主站启动失败: " .. result)
        return false
    end
    
    self.isConnected = true
    print("[EtherCAT] 主站初始化完成")
    return true
end

-- 配置PDO映射
function EtherCATMaster:configurePDO(slave)
    -- RxPDO (主站到从站) - 控制指令
    local rxPDO = {
        {index = 0x6040, subindex = 0x00, size = 16},  -- 控制字
        {index = 0x607A, subindex = 0x00, size = 32},  -- 目标位置
        {index = 0x60FF, subindex = 0x00, size = 32},  -- 目标速度
        {index = 0x6081, subindex = 0x00, size = 32},  -- 目标加速度
        {index = 0x6060, subindex = 0x00, size = 8}    -- 运行模式
    }
    
    -- TxPDO (从站到主站) - 状态反馈
    local txPDO = {
        {index = 0x6041, subindex = 0x00, size = 16},  -- 状态字
        {index = 0x6064, subindex = 0x00, size = 32},  -- 实际位置
        {index = 0x606C, subindex = 0x00, size = 32},  -- 实际速度
        {index = 0x6077, subindex = 0x00, size = 16},  -- 实际电流
        {index = 0x6041, subindex = 0x00, size = 16}   -- 状态字
    }
    
    -- 配置PDO
    for _, pdo in ipairs(rxPDO) do
        slave:configure_pdo(rxPDO, pdo.index, pdo.subindex, pdo.size)
    end
    
    for _, pdo in ipairs(txPDO) do
        slave:configure_pdo(txPDO, pdo.index, pdo.subindex, pdo.size)
    end
end

-- 发送目标位置
function EtherCATMaster:sendTargetPosition(jointIndex, position, velocity)
    if not self.isConnected or not self.slaves[jointIndex] then
        return false
    end
    
    local slave = self.slaves[jointIndex]
    
    -- 转换位置到编码器值
    local encoderPosition = self:angleToEncoder(position, jointIndex)
    
    -- 写入目标位置
    local result = slave:write_sdo(0x607A, 0x00, encoderPosition, 32)
    if result ~= 0 then
        print("[EtherCAT] 写入目标位置失败: " .. result)
        return false
    end
    
    -- 设置运行模式为位置模式
    slave:write_sdo(0x6060, 0x00, 1, 8)  -- 1 = 位置模式
    
    -- 设置控制字，使能伺服
    slave:write_sdo(0x6040, 0x00, 0x0F, 16)  -- 使能操作
    
    return true
end

-- 读取实际位置
function EtherCATMaster:readActualPosition(jointIndex)
    if not self.isConnected or not self.slaves[jointIndex] then
        return nil
    end
    
    local slave = self.slaves[jointIndex]
    
    -- 读取实际位置
    local position, result = slave:read_sdo(0x6064, 0x00, 32)
    if result ~= 0 then
        print("[EtherCAT] 读取实际位置失败: " .. result)
        return nil
    end
    
    -- 转换为角度
    return self:encoderToAngle(position, jointIndex)
end

-- 角度转编码器值
function EtherCATMaster:angleToEncoder(angle, jointIndex)
    -- 根据实际减速比和编码器分辨率转换
    local gearRatios = {160, 160, 120, 50, 50, 50}
    local encoderResolution = 131072  -- 17位编码器
    
    return math.floor((angle / 360) * encoderResolution * gearRatios[jointIndex])
end

-- 编码器值转角度
function EtherCATMaster:encoderToAngle(encoderValue, jointIndex)
    local gearRatios = {160, 160, 120, 50, 50, 50}
    local encoderResolution = 131072
    
    return (encoderValue / (encoderResolution * gearRatios[jointIndex])) * 360
end

-- 周期更新
function EtherCATMaster:update()
    if not self.isConnected then
        return false
    end
    
    -- 发送过程数据
    ecrt.send_process_data()
    
    -- 接收过程数据
    ecrt.receive_process_data(CONFIG.ethercat.timeout)
    
    self.cycleCounter = self.cycleCounter + 1
    return true
end

-- Socket服务器类
local SocketServer = {
    server = nil,
    clients = {},
    isRunning = false
}

-- 初始化Socket服务器
function SocketServer:initialize()
    print("[Socket] 初始化服务器，端口: " .. CONFIG.socket.port)
    
    -- 创建TCP服务器
    self.server = socket.tcp()
    
    -- 设置地址重用
    self.server:setoption("reuseaddr", true)
    
    -- 绑定端口
    local result = self.server:bind("*", CONFIG.socket.port)
    if result ~= 1 then
        print("[Socket] 端口绑定失败")
        return false
    end
    
    -- 开始监听
    result = self.server:listen(CONFIG.socket.maxConnections)
    if result ~= 1 then
        print("[Socket] 监听失败")
        return false
    end
    
    -- 设置为非阻塞模式
    self.server:settimeout(0)
    
    self.isRunning = true
    print("[Socket] 服务器启动完成")
    return true
end

-- 接受客户端连接
function SocketServer:acceptClient()
    if not self.isRunning then
        return
    end
    
    local client = self.server:accept()
    if client then
        client:settimeout(0)
        table.insert(self.clients, client)
        print("[Socket] 客户端连接: " .. tostring(client))
    end
end

-- 接收客户端数据
function SocketServer:receiveData()
    for i = #self.clients, 1, -1 do
        local client = self.clients[i]
        local data, err = client:receive(CONFIG.socket.bufferSize)
        
        if data then
            -- 解析指令
            self:processCommand(client, data)
        elseif err == "closed" then
            -- 客户端断开连接
            print("[Socket] 客户端断开: " .. tostring(client))
            client:close()
            table.remove(self.clients, i)
        end
    end
end

-- 发送数据到所有客户端
function SocketServer:broadcast(data)
    for i = #self.clients, 1, -1 do
        local client = self.clients[i]
        local result, err = client:send(data)
        
        if not result then
            print("[Socket] 发送失败: " .. err)
            client:close()
            table.remove(self.clients, i)
        end
    end
end

-- 解析并执行指令
function SocketServer:processCommand(client, data)
    print("[Socket] 收到指令: " .. data)
    
    -- 指令格式: [CMD,PARAM1,PARAM2,...]
    local parts = {}
    for part in string.gmatch(data, "[^,]+") do
        table.insert(parts, part)
    end
    
    if #parts == 0 then
        return
    end
    
    local cmd = parts[1]
    
    -- 处理不同指令
    if cmd == "MOVE_JOINT" and #parts >= 4 then
        -- 关节运动: MOVE_JOINT,jointIndex,angle,speed
        local jointIndex = tonumber(parts[2])
        local angle = tonumber(parts[3])
        local speed = tonumber(parts[4])
        
        if jointIndex and angle and speed then
            RobotController:moveJoint(jointIndex, angle, speed)
        end
        
    elseif cmd == "MOVE_CARTESIAN" and #parts >= 7 then
        -- 笛卡尔运动: MOVE_CARTESIAN,x,y,z,rx,ry,rz
        local x = tonumber(parts[2])
        local y = tonumber(parts[3])
        local z = tonumber(parts[4])
        local rx = tonumber(parts[5])
        local ry = tonumber(parts[6])
        local rz = tonumber(parts[7])
        
        if x and y and z then
            RobotController:moveToCartesian(x, y, z, rx or 0, ry or 0, rz or 0)
        end
        
    elseif cmd == "HOME_RESET" then
        -- 复位: HOME_RESET
        RobotController:homeReset()
        
    elseif cmd == "EMERGENCY_STOP" then
        -- 紧急停止: EMERGENCY_STOP
        RobotController:emergencyStop()
        
    elseif cmd == "GET_STATUS" then
        -- 获取状态: GET_STATUS
        local status = RobotController:getStatus()
        local statusStr = "STATUS,"
        for i = 1, #status.joints do
            statusStr = statusStr .. status.joints[i] .. ","
        end
        statusStr = statusStr .. status.endEffector.x .. "," .. status.endEffector.y .. "," .. status.endEffector.z
        
        client:send(statusStr)
    end
end

-- 机器人控制器类
local RobotController = {
    targetJoints = {0, 0, 0, 0, 0, 0},
    currentJoints = {0, 0, 0, 0, 0, 0},
    isMoving = false,
    isHoming = false
}

-- 初始化控制器
function RobotController:initialize()
    print("[Robot] 初始化控制器...")
    
    -- 初始化所有关节到零位
    for i = 1, CONFIG.robot.dof do
        self.currentJoints[i] = 0
        self.targetJoints[i] = 0
    end
    
    print("[Robot] 控制器初始化完成")
    return true
end

-- 关节运动
function RobotController:moveJoint(jointIndex, angle, speed)
    if jointIndex < 1 or jointIndex > CONFIG.robot.dof then
        print("[Robot] 无效的关节索引: " .. jointIndex)
        return false
    end
    
    -- 检查关节限位
    local limit = CONFIG.robot.jointLimits[jointIndex]
    if angle < limit.min or angle > limit.max then
        print("[Robot] 关节 " .. jointIndex .. " 超出限位")
        return false
    end
    
    -- 设置目标位置
    self.targetJoints[jointIndex] = angle
    self.isMoving = true
    
    -- 发送到EtherCAT
    EtherCATMaster:sendTargetPosition(jointIndex, angle, speed)
    
    print("[Robot] 关节 " .. jointIndex .. " 移动到 " .. angle .. "°")
    return true
end

-- 多关节同步运动
function RobotController:moveJoints(targetJoints, speed)
    if #targetJoints ~= CONFIG.robot.dof then
        print("[Robot] 关节数量不匹配")
        return false
    end
    
    -- 检查所有关节限位
    for i = 1, CONFIG.robot.dof do
        local limit = CONFIG.robot.jointLimits[i]
        if targetJoints[i] < limit.min or targetJoints[i] > limit.max then
            print("[Robot] 关节 " .. i .. " 超出限位")
            return false
        end
    end
    
    -- 设置目标位置
    for i = 1, CONFIG.robot.dof do
        self.targetJoints[i] = targetJoints[i]
        EtherCATMaster:sendTargetPosition(i, targetJoints[i], speed)
    end
    
    self.isMoving = true
    print("[Robot] 多关节同步运动")
    return true
end

-- 复位到零位
function RobotController:homeReset()
    print("[Robot] 开始复位...")
    
    self.isHoming = true
    
    -- 使用五次多项式插值进行平滑复位
    local homePositions = {0, 0, 90, 0, 90, 0}  -- 度
    
    -- 计算运动时间
    local maxDisplacement = 0
    for i = 1, CONFIG.robot.dof do
        local displacement = math.abs(homePositions[i] - self.currentJoints[i])
        maxDisplacement = math.max(maxDisplacement, displacement)
    end
    
    local moveTime = math.max(maxDisplacement / 60, 2)  -- 至少2秒
    
    -- 执行复位
    self:moveJoints(homePositions, 30)
    
    -- 等待运动完成
    os.execute("sleep " .. moveTime)
    
    self.isHoming = false
    self.isMoving = false
    
    print("[Robot] 复位完成")
end

-- 紧急停止
function RobotController:emergencyStop()
    print("[Robot] 紧急停止!")
    
    -- 立即停止所有关节
    for i = 1, CONFIG.robot.dof do
        EtherCATMaster:sendTargetPosition(i, self.currentJoints[i], 0)
    end
    
    self.isMoving = false
    self.isHoming = false
end

-- 获取机器人状态
function RobotController:getStatus()
    local status = {
        joints = {},
        endEffector = {x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0},
        isMoving = self.isMoving,
        isHoming = self.isHoming
    }
    
    -- 读取实际关节位置
    for i = 1, CONFIG.robot.dof do
        local position = EtherCATMaster:readActualPosition(i)
        if position then
            self.currentJoints[i] = position
        end
        status.joints[i] = self.currentJoints[i]
    end
    
    -- 计算正运动学得到末端位置(简化)
    status.endEffector.x = 200 * math.cos(math.rad(status.joints[1]))
    status.endEffector.y = 200 * math.sin(math.rad(status.joints[1]))
    status.endEffector.z = 100 + status.joints[2] + status.joints[3]
    
    return status
end

-- 主循环
function main()
    print("=====================================")
    print("  埃斯顿协作机器人控制服务器")
    print("  Estun Collaborative Robot Server")
    print("  版本: 1.0.0")
    print("=====================================")
    
    -- 初始化
    if not EtherCATMaster:initialize() then
        print("[Main] EtherCAT初始化失败，退出")
        return
    end
    
    if not SocketServer:initialize() then
        print("[Main] Socket服务器初始化失败，退出")
        return
    end
    
    if not RobotController:initialize() then
        print("[Main] 机器人控制器初始化失败，退出")
        return
    end
    
    print("[Main] 系统启动完成，开始主循环...")
    
    -- 主循环
    while true do
        -- 接受客户端连接
        SocketServer:acceptClient()
        
        -- 接收客户端数据
        SocketServer:receiveData()
        
        -- EtherCAT周期更新
        EtherCATMaster:update()
        
        -- 定期广播状态(10Hz)
        if EtherCATMaster.cycleCounter % 100 == 0 then
            local status = RobotController:getStatus()
            local statusStr = "STATUS,"
            for i = 1, #status.joints do
                statusStr = statusStr .. status.joints[i] .. ","
            end
            statusStr = statusStr .. status.endEffector.x .. "," .. status.endEffector.y .. "," .. status.endEffector.z
            
            SocketServer:broadcast(statusStr)
        end
        
        -- 短暂延时(10ms)
        os.execute("sleep 0.01")
    end
end

-- 异常处理
local success, err = pcall(main)
if not success then
    print("[Main] 运行时错误: " .. tostring(err))
end