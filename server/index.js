// Load environment variables first
require('dotenv').config();

// Main Server Entry Point
// Purpose: Start both WebSocket and API servers

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');

// Import our modules
const WebSocketServer = require('./websocket-server');
const EnvManager = require('../config/env-manager');
const GameLoopEngine = require('./game-loop-engine');
const DatabaseService = require('./database-service');
const LoggingService = require('./logging-service');

class MineCashServer {
  constructor() {
    this.envManager = new EnvManager();
    this.app = express();
    this.server = null;
    this.wsHttpServer = null;
    this.wsServer = null;
    this.gameEngine = null;
    this.dbService = null;
    this.logger = new LoggingService();
  }

  async initialize() {
    try {
      await this.logger.info('starting mineCash backend server...');
      
      // Initialize database service
      this.dbService = new DatabaseService();
      await this.dbService.initialize();
      await this.logger.success('database service initialized');
      
      // Initialize game loop engine
      this.gameEngine = new GameLoopEngine(this.dbService);
      await this.logger.success('game loop engine initialized');
      
      // Setup Express middleware
      this.setupMiddleware();
      await this.logger.info('express middleware configured');
      
      // Setup API routes
      this.setupRoutes();
      await this.logger.info('api routes configured');
      
      // Create HTTP server
      this.server = http.createServer(this.app);
      
      // Create separate server for WebSocket
      this.wsHttpServer = http.createServer();
      
      // Initialize WebSocket server on separate port
      this.wsServer = new WebSocketServer(this.envManager);
      await this.wsServer.initialize(this.wsHttpServer, this.gameEngine);
      await this.logger.success('websocket server initialized');
      
      // Start servers
      await this.startServer();
      
      // Log successful startup
      await this.logger.success('mineCash backend server started successfully');
      
    } catch (error) {
      await this.logger.error('failed to initialize server', { error: error.message });
      process.exit(1);
    }
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    
    // CORS configuration
    const corsOptions = {
      origin: this.envManager.isDevelopment() 
        ? ['http://localhost:5173', 'http://localhost:3000', 'https://www.minecash.org']
        : this.envManager.getApiConfig().cors,
      credentials: true
    };
    this.app.use(cors(corsOptions));
    
    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const healthData = { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };
      
      // Add memory stats if game engine is available
      if (this.gameEngine) {
        healthData.memory = this.gameEngine.getMemoryStats();
      }
      
      res.json(healthData);
    });

    // Memory monitoring endpoint
    this.app.get('/memory', (req, res) => {
      if (this.gameEngine) {
        const memoryStats = this.gameEngine.getMemoryStats();
        console.log('Memory stats being sent:', memoryStats); // Debug log
        res.json({
          memory: memoryStats,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('Game engine not available for memory stats');
        res.status(503).json({ error: 'Game engine not available' });
      }
    });

    // API routes with game engine instance
    const apiRoutes = require('../api/api-routes');
    this.app.use('/api', (req, res, next) => {
      req.gameEngine = this.gameEngine;
      next();
    }, apiRoutes);
  }

  async startServer() {
    const apiConfig = this.envManager.getApiConfig();
    const wsConfig = this.envManager.getWebSocketConfig();
    
    // Start HTTP/API server
    this.server.listen(apiConfig.port, apiConfig.host, async () => {
      await this.logger.info(`api server running on http://${apiConfig.host}:${apiConfig.port}`);
      await this.logger.info(`environment: ${this.envManager.getMode()}`);
      await this.logger.info(`debug mode: ${this.envManager.isDevelopment()}`);
    });
    
    // For production hosting, run WebSocket on same port as HTTP server
    if (this.envManager.isProduction()) {
      // Initialize WebSocket server on the same HTTP server
      await this.wsServer.initialize(this.server, this.gameEngine);
      await this.logger.success('websocket server initialized on same port as api server');
    } else {
      // Development: Use separate port for WebSocket
      this.wsHttpServer.listen(wsConfig.port, wsConfig.host, async () => {
        await this.logger.info(`webSocket server running on ws://${wsConfig.host}:${wsConfig.port}`);
      });
    }
  }

  async shutdown() {
    await this.logger.info('shutting down mineCash backend server...');
    
    if (this.wsServer) {
      await this.wsServer.shutdown();
    }
    
    if (this.gameEngine) {
      this.gameEngine.cleanup();
    }
    
    if (this.server) {
      this.server.close();
    }
    
    if (this.wsHttpServer) {
      this.wsHttpServer.close();
    }
    
    await this.logger.info('server shutdown complete');
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('sigterm received, shutting down gracefully');
  server.shutdown();
});

process.on('SIGINT', () => {
  console.log('sigint received, shutting down gracefully');
  server.shutdown();
});

// Start the server
const server = new MineCashServer();
global.serverInstance = server; // Store instance globally for emergency stop
server.initialize().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = MineCashServer; 