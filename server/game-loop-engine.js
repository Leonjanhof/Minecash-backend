// Game Loop Engine - Universal game loop template for all gamemodes
// Purpose: Standardized game state management and lifecycle

const LoggingService = require('./logging-service');
const GameConfig = require('../config/game-config');
const GameEngine = require('./core/game-engine');

class GameLoopEngine {
  constructor(databaseService = null) {
    this.games = new Map(); // gameId -> game instance
    this.gameStates = new Map(); // gameId -> state
    this.activeGames = new Set();
    this.databaseService = databaseService;
    this.logger = new LoggingService();
    this.gameConfig = new GameConfig();
    this.userLastMessageTime = new Map(); // userId -> last message timestamp
    
    // Create reusable Supabase client to prevent memory leaks
    const { createClient } = require('@supabase/supabase-js');
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Initialize the proper GameEngine
    this.gameEngine = new GameEngine(databaseService);
    
    // Start periodic cleanup to prevent memory leaks
    this.startCleanupInterval();
    
    // Load game config once during initialization
    this.gameConfig.loadConfig().then(() => {
      console.log('Game configuration loaded during initialization');
    }).catch((error) => {
      console.error('Error loading game config during initialization:', error);
    });
    
    // Log successful initialization
    console.log('Game loop engine initialized successfully');
  }

  // Start periodic cleanup interval
  startCleanupInterval() {
    // Clear any existing interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Run cleanup every 2 minutes to prevent memory buildup
    this.cleanupInterval = setInterval(() => {
      this.performMemoryCleanup();
    }, 2 * 60 * 1000);
  }

  // Perform memory cleanup
  performMemoryCleanup() {
    try {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000); // 1 hour
      
      // Clean up old user message times (older than 1 hour)
      for (const [userId, timestamp] of this.userLastMessageTime.entries()) {
        if (timestamp < oneHourAgo) {
          this.userLastMessageTime.delete(userId);
        }
      }
      
      // Force garbage collection if available
        if (global.gc) {
          global.gc();
      }
    } catch (error) {
      console.error('Error during memory cleanup:', error);
    }
  }

  // Initialize a game with proper delegation to GameEngine
  initializeGame(gamemode, gameId, config = null) {
    try {
      // Delegate to the proper GameEngine
      const gameInstance = this.gameEngine.initializeGame(gamemode, gameId, config);
      
      // Store reference for backward compatibility
      this.games.set(gameId, gameInstance);
      this.activeGames.add(gameId);
      
      // Initialize game state tracking
      this.gameStates.set(gameId, {
        phase: 'waiting',
      startTime: null,
      endTime: null,
        players: new Map(),
        bets: new Map()
      });
      
      return this.gameStates.get(gameId);
    } catch (error) {
      console.error(`Error initializing game ${gamemode}:`, error);
      throw error;
    }
  }

  // Delegate bet processing to GameEngine
  async processBet(gameId, userId, betData) {
    try {
      // Handle old gameId format (just 'crash' instead of 'crash-main')
      const actualGameId = gameId === 'crash' ? 'crash-main' : gameId;
      return await this.gameEngine.processBet(actualGameId, userId, betData);
      } catch (error) {
      console.error('Error processing bet:', error);
      return { 
        success: false, 
        message: 'Failed to process bet' 
      };
    }
  }

  // Delegate game action processing to GameEngine
  async processGameAction(gamemode, userId, action, targetMultiplier = null) {
    try {
      const gameId = `${gamemode}-main`;
      return await this.gameEngine.processGameAction(gameId, userId, action, { targetMultiplier });
    } catch (error) {
      console.error('Error processing game action:', error);
      return { 
        success: false, 
        message: 'Failed to process game action' 
      };
    }
  }

  // Delegate game state retrieval to GameEngine
  async getGameState(gameId) {
    try {
      // Handle old gameId format
      const actualGameId = gameId === 'crash' ? 'crash-main' : gameId;
      return await this.gameEngine.getGameState(actualGameId);
    } catch (error) {
      console.error('Error getting game state:', error);
      return null;
    }
  }

  // Delegate crash state retrieval to GameEngine
  async getCrashState() {
    try {
      return await this.gameEngine.getGameState('crash-main');
    } catch (error) {
      console.error('Error getting crash state:', error);
      return null;
    }
  }

  // Delegate crash game state retrieval to GameEngine
  async getCrashGameState(userId) {
    try {
      return await this.gameEngine.getGameState('crash-main', userId);
    } catch (error) {
      console.error('Error getting crash game state:', error);
      return null;
    }
  }

  // Delegate crash history retrieval to GameEngine
  async getCrashHistory(limit = 20) {
    try {
      return await this.gameEngine.getGameHistory('crash-main', limit);
    } catch (error) {
      console.error('Error getting crash history:', error);
      return [];
    }
  }

  // Backward compatibility for old game history retrieval
  async getGameHistory(gameId, limit = 20) {
    try {
      // Handle old gameId format
      const actualGameId = gameId === 'crash' ? 'crash-main' : gameId;
      return await this.gameEngine.getGameHistory(actualGameId, limit);
    } catch (error) {
      console.error('Error getting game history:', error);
      return [];
    }
  }

  // Delegate configuration methods to GameConfig
  getChatSettings() {
    return this.gameConfig.getChatSettings();
  }

  getBetLimits(gamemode) {
    return this.gameConfig.getBetLimits(gamemode);
  }

  getHouseEdge(gamemode) {
    return this.gameConfig.getHouseEdge(gamemode);
  }

  updateGameConfig(config) {
    return this.gameConfig.updateConfig(config);
  }

  async saveGameConfig() {
    return await this.gameConfig.saveConfig();
  }

  resetGameConfig() {
    return this.gameConfig.resetConfig();
  }

  getAllGameConfig() {
    return this.gameConfig.getAllConfig();
  }

  // Validation methods
  async validateBet(gameId, amount, betType, userId = null) {
    try {
      const game = this.games.get(gameId);
      if (!game) {
        return { 
          valid: false, 
          message: `Game ${gameId} is not available` 
        };
      }

      return await game.validateBet(userId, { amount, betType });
    } catch (error) {
      console.error('Error validating bet:', error);
      return { 
        valid: false, 
        message: 'Failed to validate bet' 
      };
    }
  }

  // Memory stats
  getMemoryStats() {
    try {
    const stats = {
        games: this.games.size,
      activeGames: this.activeGames.size,
        userMessageTimes: this.userLastMessageTime.size,
        gameStates: this.gameStates.size,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      };
      
      // Add GameEngine stats
      const gameEngineStats = this.gameEngine.getMemoryStats();
      return { ...stats, gameEngine: gameEngineStats };
    } catch (error) {
      console.error('Error getting memory stats:', error);
      return { error: error.message };
    }
  }

  // Stop a specific game
  async stopGame(gameId) {
    try {
      await this.gameEngine.stopGame(gameId);
      this.games.delete(gameId);
      this.activeGames.delete(gameId);
      this.gameStates.delete(gameId);
      console.log(`Stopped game: ${gameId}`);
    } catch (error) {
      console.error('Error stopping game:', error);
    }
  }

  // Stop all games
  async stopAllGames() {
    try {
      await this.gameEngine.stopAllGames();
      this.games.clear();
      this.activeGames.clear();
      this.gameStates.clear();
      console.log('Stopped all games');
    } catch (error) {
      console.error('Error stopping all games:', error);
    }
  }

  // Cleanup method
  cleanup() {
    try {
      // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
      // Cleanup GameEngine
      this.gameEngine.cleanup();
    
      // Clear all maps
    this.games.clear();
      this.activeGames.clear();
    this.gameStates.clear();
    this.userLastMessageTime.clear();
    
      console.log('Game loop engine cleanup completed');
    } catch (error) {
      console.error('Error during game loop engine cleanup:', error);
    }
  }
}

module.exports = GameLoopEngine;