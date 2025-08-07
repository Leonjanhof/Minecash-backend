// Game Configuration - Centralized game settings
// Purpose: Manage all game-related configuration and settings

class GameConfig {
  constructor() {
    this.config = {
      betLimits: {
        blackjack: { min: 10, max: 10000 },
        roulette: { min: 5, max: 5000 },
        crash: { min: 1, max: 5 },
        slots: { min: 1, max: 500 },
        hiLo: { min: 5, max: 2000 }
      },
      houseEdge: {
        blackjack: 0.05, // 2%
        roulette: 0.05, // 2.7%
        crash: 0.05, // 1%
        slots: 0.05, // 4%
        hiLo: 0.05 // 1.5%
      },
      gameTiming: {
        bettingPhase: 30000, // 30 seconds
        gamePhase: 60000, // 60 seconds (0 = unlimited for crash games)
        resultPhase: 10000 // 10 seconds
      },
      chatSettings: {
        messageRateLimit: 2000, // 2 seconds between messages
        maxMessageLength: 200,
        maxHistoryLength: 100
      },
      balanceLimits: {
        minBalance: 0,
        maxBalance: 1000000
      }
    };
    this._hasLoadedOnce = false; // Track if config has been loaded
  }

  // Get bet limits for gamemode
  getBetLimits(gamemode) {
    return this.config.betLimits[gamemode] || { min: 1, max: 1000 };
  }

  // Get house edge for gamemode
  getHouseEdge(gamemode) {
    return this.config.houseEdge[gamemode] || 0.02;
  }

  // Get game timing settings
  getGameTiming() {
    return this.config.gameTiming;
  }

  // Get chat settings
  getChatSettings() {
    return this.config.chatSettings;
  }

  // Get balance limits
  getBalanceLimits() {
    return this.config.balanceLimits;
  }

  // Validate configuration values
  validateConfig(config) {
    const errors = [];
    
    // Validate bet limits
    if (config.betLimits) {
      for (const [gamemode, limits] of Object.entries(config.betLimits)) {
        if (limits.min < 0) {
          errors.push(`${gamemode}: Minimum bet cannot be negative`);
        }
        if (limits.max <= 0) {
          errors.push(`${gamemode}: Maximum bet must be positive`);
        }
        if (limits.min >= limits.max) {
          errors.push(`${gamemode}: Minimum bet must be less than maximum bet`);
        }
      }
    }
    
    // Validate house edge
    if (config.houseEdge) {
      for (const [gamemode, edge] of Object.entries(config.houseEdge)) {
        if (edge < 0 || edge > 1) {
          errors.push(`${gamemode}: House edge must be between 0 and 1`);
        }
      }
    }
    
    // Validate game timing
    if (config.gameTiming) {
      for (const [phase, duration] of Object.entries(config.gameTiming)) {
        if (duration < 0) {
          errors.push(`${phase}: Duration cannot be negative`);
        }
      }
    }
    
    // Validate chat settings
    if (config.chatSettings) {
      if (config.chatSettings.messageRateLimit < 100) {
        errors.push('Message rate limit must be at least 100ms');
      }
      if (config.chatSettings.maxMessageLength < 1) {
        errors.push('Maximum message length must be at least 1 character');
      }
      if (config.chatSettings.maxHistoryLength < 1) {
        errors.push('Maximum history length must be at least 1 message');
      }
    }
    
    // Validate balance limits
    if (config.balanceLimits) {
      if (config.balanceLimits.minBalance < 0) {
        errors.push('Minimum balance cannot be negative');
      }
      if (config.balanceLimits.maxBalance <= 0) {
        errors.push('Maximum balance must be positive');
      }
      if (config.balanceLimits.minBalance >= config.balanceLimits.maxBalance) {
        errors.push('Minimum balance must be less than maximum balance');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  // Update configuration from database (internal method, no save)
  _updateConfigFromDatabase(newConfig) {
    // Validate new configuration
    if (!newConfig || typeof newConfig !== 'object') {
      return;
    }

    // Update bet limits
    if (newConfig.betLimits) {
      for (const [gamemode, limits] of Object.entries(newConfig.betLimits)) {
        if (limits.min !== undefined && limits.max !== undefined) {
          this.config.betLimits[gamemode] = {
            min: Math.max(1, limits.min),
            max: Math.max(limits.min, limits.max)
          };
        }
      }
    }

    // Update house edge
    if (newConfig.houseEdge) {
      for (const [gamemode, edge] of Object.entries(newConfig.houseEdge)) {
        if (edge >= 0 && edge <= 1) {
          this.config.houseEdge[gamemode] = edge;
        }
      }
    }

    // Update game timing
    if (newConfig.gameTiming) {
      for (const [phase, duration] of Object.entries(newConfig.gameTiming)) {
        if (duration > 0) {
          this.config.gameTiming[phase] = duration;
        }
      }
    }

    // Update chat settings
    if (newConfig.chatSettings) {
      for (const [setting, value] of Object.entries(newConfig.chatSettings)) {
        if (value > 0) {
          this.config.chatSettings[setting] = value;
        }
      }
    }

    // Update balance limits
    if (newConfig.balanceLimits) {
      if (newConfig.balanceLimits.minBalance !== undefined) {
        this.config.balanceLimits.minBalance = Math.max(0, newConfig.balanceLimits.minBalance);
      }
      if (newConfig.balanceLimits.maxBalance !== undefined) {
        this.config.balanceLimits.maxBalance = Math.max(this.config.balanceLimits.minBalance, newConfig.balanceLimits.maxBalance);
      }
    }
  }

  // Update configuration (public method, triggers save)
  async updateConfig(newConfig) {
    // Validate new configuration
    if (!newConfig || typeof newConfig !== 'object') {
      throw new Error('Invalid configuration object');
    }

    // Store previous config to detect changes
    const previousConfig = JSON.stringify(this.config);

    // Update bet limits
    if (newConfig.betLimits) {
      for (const [gamemode, limits] of Object.entries(newConfig.betLimits)) {
        if (limits.min !== undefined && limits.max !== undefined) {
          this.config.betLimits[gamemode] = {
            min: Math.max(1, limits.min),
            max: Math.max(limits.min, limits.max)
          };
        }
      }
    }

    // Update house edge
    if (newConfig.houseEdge) {
      for (const [gamemode, edge] of Object.entries(newConfig.houseEdge)) {
        if (edge >= 0 && edge <= 1) {
          this.config.houseEdge[gamemode] = edge;
        }
      }
    }

    // Update game timing
    if (newConfig.gameTiming) {
      for (const [phase, duration] of Object.entries(newConfig.gameTiming)) {
        if (duration > 0) {
          this.config.gameTiming[phase] = duration;
        }
      }
    }

    // Update chat settings
    if (newConfig.chatSettings) {
      for (const [setting, value] of Object.entries(newConfig.chatSettings)) {
        if (value > 0) {
          this.config.chatSettings[setting] = value;
        }
      }
    }

    // Update balance limits
    if (newConfig.balanceLimits) {
      if (newConfig.balanceLimits.minBalance !== undefined) {
        this.config.balanceLimits.minBalance = Math.max(0, newConfig.balanceLimits.minBalance);
      }
      if (newConfig.balanceLimits.maxBalance !== undefined) {
        this.config.balanceLimits.maxBalance = Math.max(this.config.balanceLimits.minBalance, newConfig.balanceLimits.maxBalance);
      }
    }

    // Only log if config actually changed
    const configChanged = JSON.stringify(this.config) !== previousConfig;
    if (configChanged) {
      console.log('Game configuration updated:', this.config);
      
      // Save to database immediately to persist changes
      try {
        await this.saveConfig();
      } catch (error) {
        console.error('Error saving game configuration:', error);
      }
    }
    
    return this.config;
  }

  // Load configuration from database
  async loadConfig() {
    try {
      // Store previous config to detect changes
      const previousConfig = JSON.stringify(this.config);
      
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      // Load game settings from database (if table exists)
      const { data: gameSettings, error } = await supabase
        .from('game_settings')
        .select('*')
        .single();

      if (!error && gameSettings) {
        // Update config with database values WITHOUT triggering save
        this._updateConfigFromDatabase({
          betLimits: gameSettings.bet_limits,
          houseEdge: gameSettings.house_edge,
          gameTiming: gameSettings.game_timing,
          chatSettings: gameSettings.chat_settings,
          balanceLimits: gameSettings.balance_limits
        });
      }

      // Only log if config actually changed AND this is the first load
      const configChanged = JSON.stringify(this.config) !== previousConfig;
      if (configChanged && !this._hasLoadedOnce) {
        console.log('Game configuration loaded from database');
        this._hasLoadedOnce = true;
      }
      return this.config;
    } catch (error) {
      console.error('Error loading game configuration:', error);
      return this.config;
    }
  }

  // Save configuration to database
  async saveConfig() {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      // Check if config has actually changed by comparing with current database state
      const { data: currentSettings, error: fetchError } = await supabase
        .from('game_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (!fetchError && currentSettings) {
        // Compare current config with database config
        const currentConfig = {
          bet_limits: currentSettings.bet_limits,
          house_edge: currentSettings.house_edge,
          game_timing: currentSettings.game_timing,
          chat_settings: currentSettings.chat_settings,
          balance_limits: currentSettings.balance_limits
        };

        const newConfig = {
          bet_limits: this.config.betLimits,
          house_edge: this.config.houseEdge,
          game_timing: this.config.gameTiming,
          chat_settings: this.config.chatSettings,
          balance_limits: this.config.balanceLimits
        };

        // If configs are identical, don't save
        if (JSON.stringify(currentConfig) === JSON.stringify(newConfig)) {
          return true; // No changes needed
        }
      }

      // Save current config to database
      const { error } = await supabase
        .from('game_settings')
        .upsert({
          id: 1,
          bet_limits: this.config.betLimits,
          house_edge: this.config.houseEdge,
          game_timing: this.config.gameTiming,
          chat_settings: this.config.chatSettings,
          balance_limits: this.config.balanceLimits,
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error saving game configuration:', error);
        return false;
      }

      // Only log when config is actually saved (not on every call)
      console.log('Game configuration saved to database');
      return true;
    } catch (error) {
      console.error('Error saving game configuration:', error);
      return false;
    }
  }

  // Get all configuration
  getAllConfig() {
    return this.config;
  }

  // Force reload config from database (for admin changes)
  async forceReloadConfig() {
    try {
      await this.loadConfig();
      console.log('Game configuration force reloaded from database');
      return this.config;
    } catch (error) {
      console.error('Error force reloading game configuration:', error);
      return this.config;
    }
  }

  // Reset configuration to defaults
  resetConfig() {
    this.config = {
      betLimits: {
        blackjack: { min: 10, max: 10000 },
        roulette: { min: 5, max: 5000 },
        crash: { min: 1, max: 1000 },
        slots: { min: 1, max: 500 },
        hiLo: { min: 5, max: 2000 }
      },
      houseEdge: {
        blackjack: 0.02, // 2%
        roulette: 0.027, // 2.7%
        crash: 0.01, // 1%
        slots: 0.04, // 4%
        hiLo: 0.015 // 1.5%
      },
      gameTiming: {
        bettingPhase: 30000, // 30 seconds
        gamePhase: 0, // Unlimited for crash games (crashes naturally)
        resultPhase: 10000 // 10 seconds
      },
      chatSettings: {
        messageRateLimit: 2000, // 2 seconds between messages
        maxMessageLength: 200,
        maxHistoryLength: 100
      },
      balanceLimits: {
        minBalance: 0,
        maxBalance: 1000000
      }
    };

    console.log('Game configuration reset to defaults');
    return this.config;
  }
}

module.exports = GameConfig; 