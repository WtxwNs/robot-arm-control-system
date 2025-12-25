/**
 * 协作机器人智能书写控制系统 - 前端应用
 * 
 * 功能：
 * - WebSocket实时通信
 * - 3D机器人可视化
 * - 关节/笛卡尔空间控制
 * - 智能书写功能
 * - 状态监控与日志
 */

class RobotControlApp {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.robotStatus = {
            joints: [0, 0, 0, 0, 0, 0],
            endEffector: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
        };
        
        // 3D可视化
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.robotModel = null;
        
        // 日志系统
        this.logContainer = document.getElementById('log-container');
        
        // 通信频率统计
        this.messageCount = 0;
        this.lastFreqUpdate = Date.now();
        
        this.init();
    }

    /**
     * 初始化应用
     */
    async init() {
        this.log('系统初始化中...', 'info');
        
        try {
            // 初始化WebSocket连接
            await this.initWebSocket();
            
            // 初始化3D可视化
            this.init3DVisualization();
            
            // 绑定UI事件
            this.bindEvents();
            
            // 启动应用
            this.start();
            
            this.log('系统初始化完成', 'success');
        } catch (error) {
            this.log(`初始化失败: ${error.message}`, 'error');
            this.showModal('初始化失败', error.message);
        }
    }

    /**
     * 初始化WebSocket连接
     */
    initWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io('http://localhost:3000', {
                    reconnectionDelay: 1000,
                    reconnection: true,
                    reconnectionAttempts: 10,
                    transports: ['websocket'],
                    agent: false,
                    upgrade: false,
                    rejectUnauthorized: false
                });

                // 连接事件
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    this.updateConnectionStatus(true);
                    this.log('WebSocket连接已建立', 'success');
                    resolve();
                });

                this.socket.on('disconnect', () => {
                    this.isConnected = false;
                    this.updateConnectionStatus(false);
                    this.log('WebSocket连接断开', 'warning');
                });

                this.socket.on('connect_error', (error) => {
                    this.isConnected = false;
                    this.updateConnectionStatus(false);
                    this.log(`连接错误: ${error.message}`, 'error');
                    reject(error);
                });

                // 机器人状态更新
                this.socket.on('robot-status-update', (status) => {
                    this.updateRobotStatus(status);
                    this.messageCount++;
                });

                this.socket.on('status-update', (status) => {
                    this.updateRobotStatus(status);
                });

                // 操作反馈
                this.socket.on('joint-move-success', (data) => {
                    this.log(`关节 J${data.jointIndex + 1} 移动到 ${data.angle.toFixed(2)}°`, 'success');
                });

                this.socket.on('cartesian-move-success', (data) => {
                    this.log(`末端移动到 (${data.x.toFixed(1)}, ${data.y.toFixed(1)}, ${data.z.toFixed(1)})`, 'success');
                });

                this.socket.on('home-reset-success', () => {
                    this.log('机器人已复位到零位', 'success');
                    this.hideLoading();
                });

                this.socket.on('handwriting-complete', () => {
                    this.log('智能书写任务完成', 'success');
                    this.hideLoading();
                });

                this.socket.on('emergency-stop-activated', () => {
                    this.log('紧急停止已激活', 'warning');
                    this.showModal('紧急停止', '机器人已紧急停止，请检查系统状态');
                });

                // 错误处理
                this.socket.on('error', (data) => {
                    this.log(`错误: ${data.message}`, 'error');
                    this.showModal('操作失败', data.message);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 初始化3D可视化
     */
    init3DVisualization() {
        try {
            const container = document.getElementById('robot-3d-view');
            const canvas = document.getElementById('robot-canvas');
            
            // 创建场景
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x0a0e1a);
            
            // 创建相机
            this.camera = new THREE.PerspectiveCamera(
                45, 
                container.clientWidth / container.clientHeight, 
                0.1, 
                1000
            );
            this.camera.position.set(300, 200, 300);
            this.camera.lookAt(0, 0, 0);
            
            // 创建渲染器
            this.renderer = new THREE.WebGLRenderer({ 
                canvas: canvas, 
                antialias: true,
                alpha: true
            });
            this.renderer.setSize(container.clientWidth, container.clientHeight);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            
            // 添加光照
            const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
            this.scene.add(ambientLight);
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(100, 100, 50);
            directionalLight.castShadow = true;
            this.scene.add(directionalLight);
            
            // 添加网格
            this.addGrid();
            
            // 创建机器人模型
            this.createRobotModel();
            
            // 添加坐标轴
            this.addCoordinateAxes();
            
            // 启动渲染循环
            this.animate();
            
            // 窗口大小调整
            window.addEventListener('resize', () => this.onWindowResize());
            
            this.log('3D可视化初始化完成', 'success');
            
        } catch (error) {
            this.log(`3D可视化初始化失败: ${error.message}`, 'warning');
        }
    }

    /**
     * 添加网格
     */
    addGrid() {
        const gridHelper = new THREE.GridHelper(800, 20, 0x444444, 0x222222);
        this.scene.add(gridHelper);
    }

    /**
     * 添加坐标轴
     */
    addCoordinateAxes() {
        const axesHelper = new THREE.AxesHelper(100);
        this.scene.add(axesHelper);
    }

    /**
     * 创建机器人模型
     */
    createRobotModel() {
        this.robotModel = new THREE.Group();
        
        // 基座
        const baseGeometry = new THREE.CylinderGeometry(50, 60, 40, 16);
        const baseMaterial = new THREE.MeshPhongMaterial({ color: 0x2196F3 });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = 20;
        base.castShadow = true;
        this.robotModel.add(base);
        
        // 关节和连杆
        this.jointMeshes = [];
        this.linkMeshes = [];
        
        // 简化的6轴机器人模型
        const jointPositions = [
            { x: 0, y: 40, z: 0 },      // J1
            { x: 0, y: 80, z: 0 },      // J2
            { x: 0, y: 120, z: 0 },     // J3
            { x: 0, y: 160, z: 0 },     // J4
            { x: 0, y: 200, z: 0 },     // J5
            { x: 0, y: 240, z: 0 }      // J6
        ];
        
        for (let i = 0; i < 6; i++) {
            // 关节
            const jointGeometry = new THREE.SphereGeometry(15, 16, 16);
            const jointMaterial = new THREE.MeshPhongMaterial({ 
                color: i % 2 === 0 ? 0xFF9800 : 0x4CAF50 
            });
            const joint = new THREE.Mesh(jointGeometry, jointMaterial);
            joint.position.copy(jointPositions[i]);
            joint.castShadow = true;
            this.jointMeshes.push(joint);
            this.robotModel.add(joint);
            
            // 连杆
            if (i < 5) {
                const linkGeometry = new THREE.CylinderGeometry(8, 8, 40, 8);
                const linkMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });
                const link = new THREE.Mesh(linkGeometry, linkMaterial);
                link.position.set(
                    (jointPositions[i].x + jointPositions[i + 1].x) / 2,
                    (jointPositions[i].y + jointPositions[i + 1].y) / 2,
                    (jointPositions[i].z + jointPositions[i + 1].z) / 2
                );
                link.castShadow = true;
                this.linkMeshes.push(link);
                this.robotModel.add(link);
            }
        }
        
        // 末端执行器
        const endEffectorGeometry = new THREE.BoxGeometry(20, 20, 40);
        const endEffectorMaterial = new THREE.MeshPhongMaterial({ color: 0xF44336 });
        const endEffector = new THREE.Mesh(endEffectorGeometry, endEffectorMaterial);
        endEffector.position.copy(jointPositions[5]);
        endEffector.position.y += 20;
        endEffector.castShadow = true;
        this.robotModel.add(endEffector);
        
        this.scene.add(this.robotModel);
    }

    /**
     * 更新机器人3D模型
     */
    updateRobotModel(joints) {
        if (!this.robotModel || !joints) return;
        
        // 简化的关节更新 (基于关节角度)
        for (let i = 0; i < Math.min(6, joints.length); i++) {
            if (this.jointMeshes[i]) {
                // 绕Y轴旋转
                this.jointMeshes[i].rotation.y = joints[i];
            }
            
            if (i < 5 && this.linkMeshes[i]) {
                this.linkMeshes[i].rotation.y = joints[i];
            }
        }
    }

    /**
     * 渲染循环
     */
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // 更新相机控制
        this.updateCameraControl();
        
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * 相机控制
     */
    updateCameraControl() {
        const time = Date.now() * 0.0005;
        
        // 自动旋转
        if (this.isConnected) {
            this.camera.position.x = 300 * Math.cos(time);
            this.camera.position.z = 300 * Math.sin(time);
            this.camera.lookAt(0, 100, 0);
        }
    }

    /**
     * 窗口大小调整
     */
    onWindowResize() {
        const container = document.getElementById('robot-3d-view');
        
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    /**
     * 绑定UI事件
     */
    bindEvents() {
        // 快速操作按钮
        document.getElementById('btn-home').addEventListener('click', () => this.homeReset());
        document.getElementById('btn-emergency-stop').addEventListener('click', () => this.emergencyStop());
        document.getElementById('btn-safety-reset').addEventListener('click', () => this.safetyReset());
        
        // 关节控制滑块
        for (let i = 0; i < 6; i++) {
            const slider = document.getElementById(`j${i+1}-slider`);
            const angleDisplay = document.getElementById(`j${i+1}-angle`);
            
            slider.addEventListener('input', (e) => {
                const angle = parseFloat(e.target.value);
                angleDisplay.textContent = `${angle.toFixed(1)}°`;
            });
            
            slider.addEventListener('change', (e) => {
                const angle = parseFloat(e.target.value) * Math.PI / 180; // 转弧度
                this.moveJoint(i, angle);
            });
        }
        
        // 关节点动按钮
        document.querySelectorAll('.btn-jog').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const jointIndex = parseInt(e.target.dataset.joint);
                const direction = parseInt(e.target.dataset.direction);
                const currentAngle = this.robotStatus.joints[jointIndex];
                const newAngle = currentAngle + direction * 0.1 * Math.PI / 180;
                
                this.moveJoint(jointIndex, newAngle);
            });
        });
        
        // 笛卡尔控制
        document.querySelectorAll('.btn-move').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const axis = e.target.dataset.axis;
                const dir = parseFloat(e.target.dataset.dir);
                const input = document.getElementById(`cart-${axis}`);
                const currentValue = parseFloat(input.value) || 0;
                const newValue = currentValue + dir;
                
                input.value = newValue.toFixed(1);
            });
        });
        
        document.getElementById('btn-cartesian-move').addEventListener('click', () => {
            const x = parseFloat(document.getElementById('cart-x').value) || 0;
            const y = parseFloat(document.getElementById('cart-y').value) || 0;
            const z = parseFloat(document.getElementById('cart-z').value) || 0;
            const rx = parseFloat(document.getElementById('cart-rx').value) || 0;
            const ry = parseFloat(document.getElementById('cart-ry').value) || 0;
            const rz = parseFloat(document.getElementById('cart-rz').value) || 0;
            
            this.moveToCartesian(x, y, z, rx, ry, rz);
        });
        
        // 智能书写
        document.getElementById('btn-handwriting-start').addEventListener('click', () => {
            const text = document.getElementById('write-text').value.trim();
            if (!text) {
                this.showModal('输入错误', '请输入要书写的文本');
                return;
            }
            
            const fontSize = parseFloat(document.getElementById('font-size').value) || 20;
            const speed = parseFloat(document.getElementById('write-speed').value) || 20;
            
            this.startHandwriting(text, { fontSize, speed });
        });
        
        // 视角控制
        document.getElementById('view-front').addEventListener('click', () => this.setView('front'));
        document.getElementById('view-top').addEventListener('click', () => this.setView('top'));
        document.getElementById('view-side').addEventListener('click', () => this.setView('side'));
        
        // 模态对话框
        document.getElementById('modal-close').addEventListener('click', () => this.hideModal());
        document.getElementById('modal-cancel').addEventListener('click', () => this.hideModal());
        document.getElementById('modal-confirm').addEventListener('click', () => this.hideModal());
        
        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.emergencyStop();
            }
        });
    }

    /**
     * 启动应用
     */
    start() {
        // 启动通信频率更新
        setInterval(() => this.updateCommunicationFrequency(), 1000);
        
        // 请求初始状态
        if (this.isConnected) {
            this.socket.emit('get-robot-status');
        }
        
        this.log('应用启动完成', 'success');
    }

    /**
     * 更新连接状态
     */
    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('robot-status');
        const statusDot = statusElement.querySelector('.status-dot');
        const statusText = statusElement.querySelector('.status-text');
        
        if (connected) {
            statusDot.classList.add('online');
            statusText.textContent = '机器人在线';
        } else {
            statusDot.classList.remove('online');
            statusText.textContent = '机器人离线';
        }
    }

    /**
     * 更新机器人状态
     */
    updateRobotStatus(status) {
        this.robotStatus = { ...this.robotStatus, ...status };
        
        // 更新关节角度显示
        if (status.joints) {
            for (let i = 0; i < 6; i++) {
                const angleDeg = (status.joints[i] * 180 / Math.PI).toFixed(1);
                document.getElementById(`j${i+1}-angle`).textContent = `${angleDeg}°`;
                document.getElementById(`j${i+1}-slider`).value = angleDeg;
            }
            
            // 更新3D模型
            this.updateRobotModel(status.joints);
        }
        
        // 更新末端执行器位置
        if (status.endEffector) {
            document.getElementById('ee-x').textContent = status.endEffector.x.toFixed(1);
            document.getElementById('ee-y').textContent = status.endEffector.y.toFixed(1);
            document.getElementById('ee-z').textContent = status.endEffector.z.toFixed(1);
        }
    }

    /**
     * 更新通信频率
     */
    updateCommunicationFrequency() {
        const now = Date.now();
        const elapsed = now - this.lastFreqUpdate;
        
        if (elapsed >= 1000) {
            const freq = Math.round(this.messageCount * 1000 / elapsed);
            document.getElementById('comm-freq').textContent = freq;
            
            this.messageCount = 0;
            this.lastFreqUpdate = now;
        }
    }

    /**
     * 关节运动
     */
    moveJoint(jointIndex, angle) {
        if (!this.isConnected) {
            this.showModal('连接错误', '机器人未连接');
            return;
        }
        
        this.socket.emit('joint-move', {
            jointIndex,
            angle,
            speed: 50
        });
    }

    /**
     * 笛卡尔空间运动
     */
    moveToCartesian(x, y, z, rx = 0, ry = 0, rz = 0) {
        if (!this.isConnected) {
            this.showModal('连接错误', '机器人未连接');
            return;
        }
        
        this.showLoading('移动到目标位置...');
        
        this.socket.emit('cartesian-move', {
            x, y, z, rx, ry, rz, speed: 50
        });
    }

    /**
     * 一键复位
     */
    homeReset() {
        if (!this.isConnected) {
            this.showModal('连接错误', '机器人未连接');
            return;
        }
        
        this.showLoading('机器人复位中...');
        this.socket.emit('home-reset', { speed: 30 });
    }

    /**
     * 智能书写
     */
    startHandwriting(text, params) {
        if (!this.isConnected) {
            this.showModal('连接错误', '机器人未连接');
            return;
        }
        
        this.showLoading('生成书写轨迹...');
        
        this.socket.emit('handwriting-start', {
            text,
            fontSize: params.fontSize,
            speed: params.speed
        });
    }

    /**
     * 紧急停止
     */
    emergencyStop() {
        if (this.isConnected && this.socket) {
            this.socket.emit('emergency-stop');
        }
        this.log('紧急停止已触发', 'warning');
    }

    /**
     * 安全复位
     */
    safetyReset() {
        this.log('安全系统复位', 'info');
        // 这里可以添加更多安全复位逻辑
    }

    /**
     * 设置视角
     */
    setView(viewType) {
        if (!this.camera) return;
        
        const distance = 300;
        
        switch (viewType) {
            case 'front':
                this.camera.position.set(0, 0, distance);
                this.camera.lookAt(0, 0, 0);
                break;
            case 'top':
                this.camera.position.set(0, distance, 0);
                this.camera.lookAt(0, 0, 0);
                break;
            case 'side':
                this.camera.position.set(distance, 0, 0);
                this.camera.lookAt(0, 0, 0);
                break;
        }
    }

    /**
     * 显示模态对话框
     */
    showModal(title, message) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').textContent = message;
        document.getElementById('modal-overlay').classList.remove('hidden');
    }

    /**
     * 隐藏模态对话框
     */
    hideModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
    }

    /**
     * 显示加载指示器
     */
    showLoading(message = '处理中...') {
        document.querySelector('.loading-spinner span').textContent = message;
        document.getElementById('loading-overlay').classList.remove('hidden');
    }

    /**
     * 隐藏加载指示器
     */
    hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    }

    /**
     * 添加日志
     */
    log(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${level}`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        this.logContainer.appendChild(logEntry);
        
        // 保持最多100条日志
        while (this.logContainer.children.length > 100) {
            this.logContainer.removeChild(this.logContainer.firstChild);
        }
        
        // 自动滚动到底部
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
}

// 应用启动
document.addEventListener('DOMContentLoaded', () => {
    window.robotApp = new RobotControlApp();
});