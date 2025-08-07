// Game Engine - Main orchestrator for all game types
// Purpose: Manage game instances, handle routing, and provide unified interface

const LoggingService = require('../services/logging-service');
const ConfigManager = require('./config-manager');
const MemoryManager = require('./memory-manager');
const EventBus = require('./event-bus');

// Import game implementations
const CrashGame = require('../games/crash-game');
const BaseGame = require('../games/base-game');

class GameEngine {
  constructor(databaseService = null) {
    this.games = new Map(); // gameId -> game instance
    this.activeGames = new Set();
    this.databaseService = databaseService;
    this.logger = new LoggingService();
    this.configManager = new ConfigManager();
    this.memoryManager = new MemoryManager();
    this.eventBus = new EventBus();
    
    // Game registry - maps game types to their implementations
    this.gameRegistry = new Map();
    this.registerGameTypes();
    
    // Initialize core systems
    this.initialize();
  }

  // Register all available game types
  registerGameTypes() {
    this.gameRegistry.set('crash', CrashGame);
    // TODO: Add other game types as they're implemented
    // this.gameRegistry.set('blackjack', BlackjackGame);
    // this.gameRegistry.set('roulette', RouletteGame);
    // this.gameRegistry.set('slots', SlotsGame);
  }

  async initialize() {
    try {
      // Initialize config manager
      await this.configManager.initialize();
      
      // Initialize memory manager
      this.memoryManager.initialize();
      
      // Initialize event bus
      this.eventBus.initialize();
      
      // Initialize default games
      await this.initializeDefaultGames();
      
      this.logger.info('game engine initialized successfully');
    } catch (error) {
      this.logger.error('failed to initialize game engine', { error: error.message });
      throw error;
    }
  }

  async initializeDefaultGames() {
    // Initialize crash game
    await this.initializeGame('crash', 'crash-main');
    
    // TODO: Initialize other games as needed
    // await this.initializeGame('blackjack', 'blackjack-main');
    // await this.initializeGame('roulette', 'roulette-main');
  }

  async initializeGame(gameType, gameId, config = null) {
    try {
      // Check if game type is registered
      const GameClass = this.gameRegistry.get(gameType);
      if (!GameClass) {
        throw new Error(`Unknown game type: ${gameType}`);
      }

      // Get game configuration
      const gameConfig = await this.configManager.getGameConfig(gameType, config);
      
      // Create game instance
      const gameInstance = new GameClass(gameId, gameConfig, {
        databaseService: this.databaseService,
        logger: this.logger,
        eventBus: this.eventBus,
        configManager: this.configManager
      });

      // Initialize the game
      await gameInstance.initialize();
      
      // Register the game
      this.games.set(gameId, gameInstance);
      this.activeGames.add(gameId);
      
      this.logger.info(`initialized ${gameType} game: ${gameId}`);
      
      return gameInstance;
    } catch (error) {
      this.logger.error(`failed to initialize ${gameType} game`, { error: error.message });
      throw error;
    }
  }

  async processBet(gameId, userId, betData) {
    try {
      const game = this.games.get(gameId);
      if (!game) {
        return { 
          success: false, 
          message: `Game ${gameId} is not available` 
        };
      }

      return await game.processBet(userId, betData);
    } catch (error) {
      this.logger.error('error processing bet', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process bet' 
      };
    }
  }

  async processGameAction(gameId, userId, action, data = null) {
    try {
      const game = this.games.get(gameId);
      if (!game) {
        return { 
          success: false, 
          message: `Game ${gameId} is not available` 
        };
      }

      return await game.processAction(userId, action, data);
    } catch (error) {
      this.logger.error('error processing game action', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process game action' 
      };
    }
  }

  // NEW: Generic cashout processing
  async processCashout(gameId, userId, cashoutValue) {
    try {
      const game = this.games.get(gameId);
      if (!game) {
        return { 
          success: false, 
          message: `Game ${gameId} is not available` 
        };
      }

      return await game.processCashout(userId, cashoutValue);
    } catch (error) {
      this.logger.error('error processing cashout', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process cashout' 
      };
    }
  }

  // NEW: Generic auto-cashout processing
  async processAutoCashout(gameId, userId, targetValue) {
    try {
      const game = this.games.get(gameId);
      if (!game) {
        return { 
          success: false, 
          message: `Game ${gameId} is not available` 
        };
      }

      return await game.processAutoCashout(userId, targetValue);
    } catch (error) {
      this.logger.error('error processing auto-cashout', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process auto-cashout' 
      };
    }
  }

  async getGameState(gameId, userId = null) {
    try {
      const game = this.games.get(gameId);
      if (!game) {
        return null;
      }

      return await game.getState(userId);
    } catch (error) {
      this.logger.error('error getting game state', { error: error.message });
      return null;
    }
  }

  async getGameHistory(gameId, limit = 20) {
    try {
      const game = this.games.get(gameId);
      if (!game) {
        return [];
      }

      return await game.getHistory(limit);
    } catch (error) {
      this.logger.error('error getting game history', { error: error.message });
      return [];
    }
  }

  getActiveGames() {
    return Array.from(this.activeGames);
  }

  getGameConfig(gameType) {
    return this.configManager.getGameConfig(gameType);
  }

  async updateGameConfig(gameType, config) {
    return await this.configManager.updateGameConfig(gameType, config);
  }

  getMemoryStats() {
    return this.memoryManager.getStats();
  }

  async stopGame(gameId) {
    try {
      const game = this.games.get(gameId);
      if (game) {
        await game.stop();
        this.games.delete(gameId);
        this.activeGames.delete(gameId);
        this.logger.info(`stopped game: ${gameId}`);
      }
    } catch (error) {
      this.logger.error('error stopping game', { error: error.message });
    }
  }

  async stopAllGames() {
    try {
      for (const [gameId, game] of this.games) {
        await game.stop();
      }
      this.games.clear();
      this.activeGames.clear();
      this.logger.info('stopped all games');
    } catch (error) {
      this.logger.error('error stopping all games', { error: error.message });
    }
  }

  // Cleanup method
  async cleanup() {
    try {
      await this.stopAllGames();
      this.memoryManager.cleanup();
      this.eventBus.cleanup();
      this.logger.info('game engine cleanup completed');
    } catch (error) {
      this.logger.error('error during game engine cleanup', { error: error.message });
    }
  }
}

module.exports = GameEngine; 