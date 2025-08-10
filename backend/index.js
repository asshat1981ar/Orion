#!/usr/bin/env node

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for demo (replace with Neo4j/Redis in production)
const agents = new Map();
const tasks = new Map();
const workflows = new Map();
const metrics = {
  connections: 0,
  messagesProcessed: 0,
  activeAgents: 0,
  completedTasks: 0
};

// Enhanced Agent class for the orchestrator
class OrchestrationAgent {
  constructor(id, capabilities, socketId) {
    this.id = id;
    this.capabilities = capabilities;
    this.socketId = socketId;
    this.status = 'active';
    this.tasksCompleted = 0;
    this.avgResponseTime = 0;
    this.lastSeen = new Date();
    this.performance = {
      successRate: 0.95,
      totalTasks: 0,
      totalResponseTime: 0
    };
  }

  updatePerformance(responseTime, success = true) {
    this.performance.totalTasks++;
    if (success) {
      this.tasksCompleted++;
      this.performance.totalResponseTime += responseTime;
      this.avgResponseTime = this.performance.totalResponseTime / this.tasksCompleted;
    }
    this.performance.successRate = this.tasksCompleted / this.performance.totalTasks;
    this.lastSeen = new Date();
  }

  canHandle(capability) {
    return this.capabilities.includes(capability);
  }

  getStatus() {
    return {
      id: this.id,
      capabilities: this.capabilities,
      status: this.status,
      tasksCompleted: this.tasksCompleted,
      avgResponseTime: this.avgResponseTime,
      successRate: this.performance.successRate,
      lastSeen: this.lastSeen
    };
  }
}

// REST API Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    metrics: {
      ...metrics,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  });
});

app.get('/agents', (req, res) => {
  const agentList = Array.from(agents.values()).map(agent => agent.getStatus());
  res.json({
    agents: agentList,
    total: agents.size
  });
});

app.get('/tasks', (req, res) => {
  const taskList = Array.from(tasks.values());
  res.json({
    tasks: taskList,
    total: tasks.size
  });
});

app.post('/tasks', (req, res) => {
  const { type, capability, data, priority = 'medium' } = req.body;
  
  const task = {
    id: uuidv4(),
    type,
    capability,
    data,
    priority,
    status: 'pending',
    createdAt: new Date(),
    assignedAgent: null,
    result: null
  };
  
  tasks.set(task.id, task);
  
  // Try to assign to available agent
  const availableAgent = findBestAgent(capability);
  if (availableAgent) {
    assignTask(task, availableAgent);
  }
  
  res.status(201).json(task);
});

app.get('/metrics', (req, res) => {
  res.json({
    ...metrics,
    agents: Array.from(agents.values()).map(agent => ({
      id: agent.id,
      tasksCompleted: agent.tasksCompleted,
      avgResponseTime: agent.avgResponseTime,
      successRate: agent.performance.successRate
    }))
  });
});

// WebSocket handling
io.on('connection', (socket) => {
  console.log(`🔗 Client connected: ${socket.id}`);
  metrics.connections++;
  
  // Handle ping/pong for heartbeat
  socket.on('ping', (data) => {
    socket.emit('pong', { ...data, serverTime: Date.now() });
  });
  
  // Agent registration
  socket.on('agent:register', (data) => {
    const { agentId, capabilities } = data;
    const agent = new OrchestrationAgent(agentId, capabilities, socket.id);
    agents.set(agentId, agent);
    metrics.activeAgents = agents.size;
    
    console.log(`🤖 Agent registered: ${agentId} (${capabilities.length} capabilities)`);
    
    socket.emit('agent:registered', {
      agentId,
      status: 'registered',
      timestamp: new Date()
    });
    
    // Broadcast to all clients about new agent
    socket.broadcast.emit('agent:joined', agent.getStatus());
  });
  
  // Agent task completion
  socket.on('agent:task-complete', (data) => {
    const { taskId, result, responseTime, success = true } = data;
    const task = tasks.get(taskId);
    
    if (task && task.assignedAgent) {
      const agent = agents.get(task.assignedAgent);
      if (agent) {
        agent.updatePerformance(responseTime, success);
        task.status = success ? 'completed' : 'failed';
        task.result = result;
        task.completedAt = new Date();
        
        if (success) metrics.completedTasks++;
        
        console.log(`✅ Task ${taskId} completed by ${agent.id}: ${success ? 'SUCCESS' : 'FAILED'}`);
        
        // Notify all clients about task completion
        io.emit('task:completed', {
          taskId,
          agentId: agent.id,
          result,
          success,
          timestamp: new Date()
        });
      }
    }
  });
  
  // Agent message handling
  socket.on('agent:message', (data) => {
    metrics.messagesProcessed++;
    console.log(`📨 Agent message:`, data);
    
    // Route message to target agent or broadcast
    if (data.targetAgent) {
      const targetAgent = agents.get(data.targetAgent);
      if (targetAgent) {
        io.to(targetAgent.socketId).emit('agent:message', data);
      }
    } else {
      socket.broadcast.emit('agent:broadcast', data);
    }
  });
  
  // Workflow execution request
  socket.on('workflow:execute', async (workflowData) => {
    console.log(`🚀 Workflow execution requested: ${workflowData.name}`);
    
    const workflow = {
      id: uuidv4(),
      name: workflowData.name,
      tasks: workflowData.tasks,
      status: 'executing',
      startTime: new Date(),
      results: []
    };
    
    workflows.set(workflow.id, workflow);
    
    // Execute workflow
    try {
      await executeWorkflow(workflow, socket);
    } catch (error) {
      console.error(`❌ Workflow ${workflow.id} failed:`, error);
      workflow.status = 'failed';
      workflow.error = error.message;
    }
    
    socket.emit('workflow:completed', workflow);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    metrics.connections--;
    
    // Remove any agents associated with this socket
    for (const [agentId, agent] of agents.entries()) {
      if (agent.socketId === socket.id) {
        agents.delete(agentId);
        metrics.activeAgents = agents.size;
        console.log(`🤖 Agent unregistered: ${agentId}`);
        
        socket.broadcast.emit('agent:left', { agentId });
      }
    }
  });
});

// Helper functions
function findBestAgent(capability) {
  const suitableAgents = Array.from(agents.values())
    .filter(agent => agent.canHandle(capability) && agent.status === 'active')
    .sort((a, b) => b.performance.successRate - a.performance.successRate);
  
  return suitableAgents.length > 0 ? suitableAgents[0] : null;
}

function assignTask(task, agent) {
  task.assignedAgent = agent.id;
  task.status = 'assigned';
  task.assignedAt = new Date();
  
  console.log(`📋 Task ${task.id} assigned to ${agent.id}`);
  
  // Notify the agent about the new task
  io.to(agent.socketId).emit('task:assigned', {
    taskId: task.id,
    type: task.type,
    capability: task.capability,
    data: task.data,
    priority: task.priority
  });
}

async function executeWorkflow(workflow, socket) {
  console.log(`⚡ Executing workflow: ${workflow.name}`);
  
  const parallelTasks = workflow.tasks.filter(task => task.parallel && !task.dependencies);
  const sequentialTasks = workflow.tasks.filter(task => !task.parallel || task.dependencies);
  
  // Execute parallel tasks
  if (parallelTasks.length > 0) {
    console.log(`🔄 Executing ${parallelTasks.length} parallel tasks`);
    const parallelPromises = parallelTasks.map(task => executeWorkflowTask(task, socket));
    const parallelResults = await Promise.allSettled(parallelPromises);
    workflow.results.push(...parallelResults.map(r => r.value || { success: false, error: r.reason }));
  }
  
  // Execute sequential tasks
  for (const task of sequentialTasks) {
    console.log(`🔄 Executing sequential task: ${task.name}`);
    const result = await executeWorkflowTask(task, socket);
    workflow.results.push(result);
  }
  
  workflow.status = 'completed';
  workflow.endTime = new Date();
  workflow.duration = workflow.endTime - workflow.startTime;
  
  console.log(`✅ Workflow ${workflow.name} completed in ${workflow.duration}ms`);
}

async function executeWorkflowTask(task, socket) {
  return new Promise((resolve) => {
    const agent = findBestAgent(task.capability);
    
    if (!agent) {
      resolve({
        task: task.name,
        success: false,
        error: 'No suitable agent available',
        timestamp: new Date()
      });
      return;
    }
    
    const taskId = uuidv4();
    const startTime = Date.now();
    
    // Set up task completion listener
    const timeoutId = setTimeout(() => {
      resolve({
        task: task.name,
        success: false,
        error: 'Task timeout',
        agent: agent.id,
        duration: Date.now() - startTime,
        timestamp: new Date()
      });
    }, 30000); // 30 second timeout
    
    // Listen for task completion
    socket.once(`task:${taskId}:complete`, (result) => {
      clearTimeout(timeoutId);
      resolve({
        task: task.name,
        agent: agent.id,
        duration: Date.now() - startTime,
        timestamp: new Date(),
        ...result
      });
    });
    
    // Assign task to agent
    io.to(agent.socketId).emit('workflow:task', {
      taskId,
      ...task,
      socketId: socket.id
    });
  });
}

// Start server
server.listen(PORT, () => {
  console.log('🌟 ORION ORCHESTRATOR STARTED');
  console.log('=' .repeat(40));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Metrics: http://localhost:${PORT}/metrics`);
  console.log(`🤖 Agents: http://localhost:${PORT}/agents`);
  console.log('=' .repeat(40));
});