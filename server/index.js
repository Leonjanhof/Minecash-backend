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
const GameEngine = require('./core/game-engine');
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
      
      // Initialize game engine with proper architecture
      this.gameEngine = new GameEngine(this.dbService);
      await this.gameEngine.initialize();
      await this.logger.success('game engine initialized');
      
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
    // Add game engine to request object for API routes
    this.app.use((req, res, next) => {
      req.gameEngine = this.gameEngine;
      next();
    });

    // API routes
    const apiRoutes = require('../api/api-routes');
    this.app.use('/api', apiRoutes);

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const healthData = { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };
      
      res.json(healthData);
    });

    // Game config endpoint
    this.app.get('/api/config/:gameType', (req, res) => {
      try {
        const { gameType } = req.params;
        const config = this.gameEngine.getGameConfig(gameType);
        res.json(config);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get game config' });
      }
    });

    // Game engine health check endpoint (internal monitoring)
    this.app.get('/health/game-engine', (req, res) => {
      try {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          games: this.gameEngine.getActiveGames(),
          memory: this.gameEngine.getMemoryStats(),
          uptime: process.uptime()
        };
        res.json(health);
      } catch (error) {
        res.status(500).json({ 
          status: 'unhealthy',
          error: 'Game engine health check failed',
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  async startServer() {
    try {
      // Start API server
      const apiConfig = this.envManager.getApiConfig();
      this.server.listen(apiConfig.port, apiConfig.host, () => {
        console.log(`API server running on ${apiConfig.host}:${apiConfig.port}`);
      });
      
      // Start WebSocket server
      const wsConfig = this.envManager.getWebSocketConfig();
      this.wsHttpServer.listen(wsConfig.port, wsConfig.host, () => {
        console.log(`WebSocket server running on ${wsConfig.host}:${wsConfig.port}`);
      });
      
      // Set global server instance for WebSocket access
      global.serverInstance = this;
      
    } catch (error) {
      await this.logger.error('failed to start servers', { error: error.message });
      throw error;
    }
  }

  async shutdown() {
    try {
      await this.logger.info('shutting down mineCash backend server...');
      
      // Cleanup game engine
      if (this.gameEngine) {
        await this.gameEngine.cleanup();
      }
      
      // Close servers
      if (this.server) {
        this.server.close();
      }
      
      if (this.wsHttpServer) {
        this.wsHttpServer.close();
      }
      
      await this.logger.success('mineCash backend server shutdown completed');
      
    } catch (error) {
      await this.logger.error('error during shutdown', { error: error.message });
    }
  }
}

// Create and start server
const server = new MineCashServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  await server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  await server.shutdown();
  process.exit(0);
});

// Start the server
server.initialize().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
}); 