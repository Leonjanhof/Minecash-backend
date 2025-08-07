// Config Manager - Centralized configuration management
// Purpose: Handle all game configuration, settings, and validation

const GameConfig = require('../../config/game-config');

class ConfigManager {
  constructor() {
    this.gameConfig = new GameConfig();
    this.configCache = new Map(); // Cache for frequently accessed configs
    this.lastConfigReload = Date.now();
    this.configReloadInterval = 300000; // 5 minutes
    this._hasStartedReloadCycle = false;
  }

  async initialize() {
    try {
      await this.gameConfig.loadConfig();
      this._hasStartedReloadCycle = true;
      console.log('config manager initialized successfully');
    } catch (error) {
      console.error('error initializing config manager:', error);
      throw error;
    }
  }

  async getGameConfig(gameType, customConfig = null) {
    // Reload config periodically
    await this.reloadConfigIfNeeded();

    // Get base config for game type
    const betLimits = this.gameConfig.getBetLimits(gameType);
    const houseEdge = this.gameConfig.getHouseEdge(gameType);
    const gameTiming = this.gameConfig.getGameTiming();

    let gameConfig = {
      minBet: betLimits.min,
      maxBet: betLimits.max,
      houseEdge: houseEdge,
      timing: gameTiming
    };

    // Merge with custom config if provided
    if (customConfig) {
      gameConfig = {
        ...gameConfig,
        ...customConfig
      };
    }

    return gameConfig;
  }

  async reloadConfigIfNeeded() {
    const now = Date.now();
    if (!this.lastConfigReload || (now - this.lastConfigReload) > this.configReloadInterval) {
      try {
        await this.gameConfig.loadConfig();
        this.lastConfigReload = now;
        
        // Only log once per reload cycle, not on startup
        if (this._hasStartedReloadCycle) {
          console.log('game configuration reloaded from database (5-minute cycle)');
        } else {
          this._hasStartedReloadCycle = true;
        }
      } catch (error) {
        // Silent error handling - no logging
      }
    }
  }

  getBetLimits(gameType) {
    return this.gameConfig.getBetLimits(gameType);
  }

  getHouseEdge(gameType) {
    return this.gameConfig.getHouseEdge(gameType);
  }

  getGameTiming() {
    return this.gameConfig.getGameTiming();
  }

  getChatSettings() {
    return this.gameConfig.getChatSettings();
  }

  async updateGameConfig(gameType, config) {
    return await this.gameConfig.updateConfig(config);
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

  // Validate bet for any game type
  async validateBet(gameType, amount, betType, userId = null) {
    const betLimits = this.getBetLimits(gameType);
    
    if (amount < betLimits.min || amount > betLimits.max) {
      return { 
        valid: false, 
        message: `bet amount must be between ${betLimits.min} and ${betLimits.max}`, 
        minBet: betLimits.min, 
        maxBet: betLimits.max 
      };
    }

    return { valid: true };
  }

  // Get all available game types
  getAvailableGameTypes() {
    return ['crash']; // TODO: Add other game types as they're implemented
  }

  // Check if game type is supported
  isGameTypeSupported(gameType) {
    return this.getAvailableGameTypes().includes(gameType);
  }
}

module.exports = ConfigManager; 