// Game Configuration - Centralized game settings
// Purpose: Manage all game-related configuration and settings

class GameConfig {
  constructor() {
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

  // Update configuration
  updateConfig(newConfig) {
    // Validate new configuration
    if (!newConfig || typeof newConfig !== 'object') {
      throw new Error('Invalid configuration object');
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

    console.log('Game configuration updated:', this.config);
    return this.config;
  }

  // Load configuration from database
  async loadConfig() {
    try {
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
        // Update config with database values
        this.updateConfig({
          betLimits: gameSettings.bet_limits,
          houseEdge: gameSettings.house_edge,
          gameTiming: gameSettings.game_timing,
          chatSettings: gameSettings.chat_settings,
          balanceLimits: gameSettings.balance_limits
        });
      }

      console.log('Game configuration loaded from database');
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