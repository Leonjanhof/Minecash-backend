// Game Loop Engine - Universal game loop template for all gamemodes
// Purpose: Standardized game state management and lifecycle

const LoggingService = require('./logging-service');
const GameConfig = require('../config/game-config');

class GameLoopEngine {
  constructor(databaseService = null) {
    this.games = new Map(); // gameId -> game instance
    this.gameStates = new Map(); // gameId -> state
    this.activeGames = new Set();
    this.databaseService = databaseService;
    this.logger = new LoggingService();
    this.gameConfig = new GameConfig();
    this.userLastMessageTime = new Map(); // userId -> last message timestamp
    
    // Crash game specific state
    this.crashState = {
      phase: 'waiting', // waiting, betting, playing, crashed
      currentRoundId: null,
      currentMultiplier: 1.00,
      phaseStartTime: Date.now(),
      activePlayersCount: 0,
      totalBetAmount: 0.00,
      currentCrashPoint: 1.00,
      currentRoundNumber: 1,
      gameHash: null, // Add hash for transparency
      serverSeed: null, // Add server seed for transparency
      clientSeed: null // Add client seed for transparency
    };
    
    this.crashGameLoop = null;
    
    // Initialize crash in the generic game system using GameConfig
    const crashConfig = this.gameConfig.getBetLimits('crash');
    const crashHouseEdge = this.gameConfig.getHouseEdge('crash');
    this.initializeGame('crash', 'crash-main', {
      minBet: crashConfig.min,
      maxBet: crashConfig.max,
      houseEdge: crashHouseEdge
    });
  }

  // Initialize a new game session
  initializeGame(gamemode, gameId, config = null) {
    console.log(`initializing ${gamemode} game: ${gameId}`);
    
    // Use GameConfig if no config provided, or merge with provided config
    let gameConfig;
    if (!config) {
      const betLimits = this.gameConfig.getBetLimits(gamemode);
      const houseEdge = this.gameConfig.getHouseEdge(gamemode);
      const gameTiming = this.gameConfig.getGameTiming();
      
      gameConfig = {
        minBet: betLimits.min,
        maxBet: betLimits.max,
        houseEdge: houseEdge,
        timing: gameTiming
      };
    } else {
      // Merge provided config with GameConfig defaults
      const betLimits = this.gameConfig.getBetLimits(gamemode);
      const houseEdge = this.gameConfig.getHouseEdge(gamemode);
      const gameTiming = this.gameConfig.getGameTiming();
      
      gameConfig = {
        minBet: config.minBet || betLimits.min,
        maxBet: config.maxBet || betLimits.max,
        houseEdge: config.houseEdge || houseEdge,
        timing: config.timing || gameTiming
      };
    }
    
    const gameState = {
      id: gameId,
      gamemode,
      phase: 'waiting', // waiting, betting, playing, results
      players: new Map(),
      bets: new Map(),
      startTime: null,
      endTime: null,
      config: gameConfig,
      phaseStartTime: null,
      phaseEndTime: null
    };
    
    this.gameStates.set(gameId, gameState);
    this.activeGames.add(gameId);
    
    // Initialize specific game types
    if (gamemode === 'crash') {
      this.initializeCrashGame();
    }
    // TODO: Add initialization for other gamemodes (blackjack, roulette, slots, hi-lo)
    
    return gameState;
  }

  // Initialize crash game
  async initializeCrashGame() {
    // Create initial crash round
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Check if game state exists, if not reset everything
    const { data: existingState, error: stateCheckError } = await supabase
      .from('crash_game_state')
      .select('id')
      .eq('id', 1)
      .single();
    
    if (stateCheckError || !existingState) {
      console.log('crash game state missing, resetting rounds...');
      try {
        await supabase.rpc('reset_crash_rounds');
        console.log('crash rounds reset successfully');
      } catch (resetError) {
        console.error('error resetting crash rounds:', resetError);
      }
    }
    
    const crypto = require('crypto');
    const serverSeed = crypto.randomBytes(32).toString('hex');
    
    const { data: roundId, error: roundError } = await supabase.rpc('create_crash_round', {
      p_server_seed: serverSeed,
      p_client_seed: 'default'
    });
    
    if (roundError) {
      console.error('error creating initial crash round:', roundError);
      return;
    }
    
    // Get the created round to get the correct round number
    const { data: roundData, error: fetchError } = await supabase
      .from('crash_rounds')
      .select('id, round_number, crash_multiplier, game_hash, server_seed, client_seed')
      .eq('id', roundId)
      .single();
    
    if (fetchError) {
      console.error('error fetching round data:', fetchError);
      return;
    }
    
    this.crashState.currentRoundId = roundData.id;
    this.crashState.currentRoundNumber = roundData.round_number;
    this.crashState.phase = 'betting';
    this.crashState.phaseStartTime = Date.now();
    this.crashState.currentCrashPoint = roundData.crash_multiplier;
    this.crashState.gameHash = roundData.game_hash;
    this.crashState.serverSeed = roundData.server_seed;
    this.crashState.clientSeed = roundData.client_seed;
    
    // Always create/update the game state row (upsert)
    try {
      await supabase
        .from('crash_game_state')
        .upsert({
          id: 1,
          current_round_id: roundData.id,
          phase: 'betting',
          phase_start_time: new Date().toISOString(),
          current_multiplier: 1.00,
          active_players_count: 0,
          total_bet_amount: 0.00,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });
      console.log('crash game state initialized');
    } catch (stateError) {
      console.error('error updating crash game state:', stateError);
    }
    
    // Start crash game loop
    this.startCrashGameLoop();
  }

  // Start crash game loop
  startCrashGameLoop() {
    this.crashGameLoop = setInterval(() => {
      this.updateCrashGameLoop();
    }, 1000); // Update every second
  }

  // Update crash game loop
  async updateCrashGameLoop() {
    const timeElapsed = (Date.now() - this.crashState.phaseStartTime) / 1000.0;
    const gameTiming = this.gameConfig.getGameTiming();

    if (this.crashState.phase === 'betting') {
      // Start game after betting phase duration from GameConfig
      if (timeElapsed > (gameTiming.bettingPhase / 1000)) {
        await this.startCrashGame();
      }
    } else if (this.crashState.phase === 'playing') {
      // Update multiplier
      this.crashState.currentMultiplier = (1.0024 * Math.pow(1.0718, timeElapsed)).toFixed(2);
      
      // Process auto-cashouts every 0.1 seconds (10 times per second)
      if (Math.floor(timeElapsed * 10) !== Math.floor((timeElapsed - 0.1) * 10)) {
        try {
          const { createClient } = require('@supabase/supabase-js');
          const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
          );
          
          // Process auto-cashouts
          const { data: autoCashoutResult, error: autoCashoutError } = await supabase.rpc('process_crash_auto_cashouts', {
            p_round_id: this.crashState.currentRoundId,
            p_current_multiplier: parseFloat(this.crashState.currentMultiplier)
          });
          
          if (autoCashoutError) {
            await this.logger.error('error processing auto-cashouts', { error: autoCashoutError.message });
          } else if (autoCashoutResult && autoCashoutResult.processed_count > 0) {
            await this.logger.info(`processed ${autoCashoutResult.processed_count} auto-cashouts at ${this.crashState.currentMultiplier}x`);
          }
        } catch (error) {
          await this.logger.error('failed to process auto-cashouts', { error: error.message });
        }
      }
      
      // Update database state
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        await supabase
          .from('crash_game_state')
          .update({
            current_multiplier: this.crashState.currentMultiplier,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);
      } catch (error) {
        console.error('error updating crash game state:', error);
      }
      
      // Check if crashed - only handle once
      if (parseFloat(this.crashState.currentMultiplier) >= parseFloat(this.crashState.currentCrashPoint) && this.crashState.phase === 'playing') {
        // Set the final multiplier to exactly the crash point
        this.crashState.currentMultiplier = this.crashState.currentCrashPoint;
        await this.handleCrashGame();
      }
    } else if (this.crashState.phase === 'crashed') {
      // Start new round after result phase duration from GameConfig
      if (timeElapsed > (gameTiming.resultPhase / 1000)) {
        await this.startNewCrashRound();
      }
    }
  }

  // Start crash game
  async startCrashGame() {
    this.crashState.phase = 'playing';
    this.crashState.phaseStartTime = Date.now();
    await this.logger.gameEvent('crash', `game started: round ${this.crashState.currentRoundNumber}, crash point: ${this.crashState.currentCrashPoint}x`);
    
    // Update database state
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      await supabase
        .from('crash_game_state')
        .update({
          phase: 'playing',
          phase_start_time: new Date().toISOString(),
          current_multiplier: 1.00,
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);
    } catch (error) {
      await this.logger.error('error updating crash game state', { error: error.message });
    }
  }

  // Handle crash game end
  async handleCrashGame() {
    this.crashState.phase = 'crashed';
    this.crashState.phaseStartTime = Date.now();
    await this.logger.gameEvent('crash', `game ended at ${this.crashState.currentCrashPoint}x (round ${this.crashState.currentRoundNumber})`);
    
    // Update database state
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Update the crash round with final multiplier
      if (this.crashState.currentRoundId) {
        await supabase
          .from('crash_rounds')
          .update({
            crash_multiplier: this.crashState.currentCrashPoint,
            phase: 'crashed',
            updated_at: new Date().toISOString()
          })
          .eq('id', this.crashState.currentRoundId);
      }
      
      await supabase
        .from('crash_game_state')
        .update({
          phase: 'crashed',
          phase_start_time: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);
    } catch (error) {
      await this.logger.error('error updating crash game state', { error: error.message });
    }
    
    // Process remaining players
    await this.processRemainingCrashPlayers();
  }

  // Process remaining crash players
  async processRemainingCrashPlayers() {
    // Update bet status to crashed for all active players
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Use the database round ID
    const roundId = this.crashState.currentRoundId;
    
    try {
      // Update all active bets to crashed status
      const { error: updateError } = await supabase
        .from('crash_bets')
        .update({
          status: 'crashed',
          updated_at: new Date().toISOString()
        })
        .eq('round_id', roundId)
        .eq('status', 'active');
      
      if (updateError) {
        await this.logger.error('error updating crashed bets', { error: updateError.message });
      } else {
        await this.logger.info('updated remaining crash bets to crashed status');
      }
      
      // Update game state to reset player count
      await supabase
        .from('crash_game_state')
        .update({
          active_players_count: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);
        
    } catch (error) {
      await this.logger.error('error processing remaining crash players', { error: error.message });
    }
  }

  // Start new crash round
  async startNewCrashRound() {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Complete the previous round first
    if (this.crashState.currentRoundId) {
      try {
        await supabase
          .from('crash_rounds')
          .update({
            phase: 'completed',
            end_time: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', this.crashState.currentRoundId);
        
        await this.logger.info(`completed crash round ${this.crashState.currentRoundNumber} at ${this.crashState.currentCrashPoint}x`);
      } catch (error) {
        await this.logger.error('error completing previous crash round', { error: error.message });
      }
    }
    
    const crypto = require('crypto');
    const serverSeed = crypto.randomBytes(32).toString('hex');
    
    const { data: roundId, error: roundError } = await supabase.rpc('create_crash_round', {
      p_server_seed: serverSeed,
      p_client_seed: 'default'
    });
    
    if (roundError) {
      await this.logger.error('error creating new crash round', { error: roundError.message });
      return;
    }
    
    // Get the created round to get the correct round number
    const { data: roundData, error: fetchError } = await supabase
      .from('crash_rounds')
      .select('id, round_number, crash_multiplier, game_hash, server_seed, client_seed')
      .eq('id', roundId)
      .single();
    
    if (fetchError) {
      await this.logger.error('error fetching round data', { error: fetchError.message });
      return;
    }
    
    this.crashState.currentRoundId = roundData.id;
    this.crashState.currentRoundNumber = roundData.round_number;
    this.crashState.phase = 'betting';
    this.crashState.phaseStartTime = Date.now();
    this.crashState.currentMultiplier = 1.00;
    this.crashState.currentCrashPoint = roundData.crash_multiplier;
    this.crashState.gameHash = roundData.game_hash;
    this.crashState.serverSeed = roundData.server_seed;
    this.crashState.clientSeed = roundData.client_seed;
    
    // Update database state
    try {
      await supabase
        .from('crash_game_state')
        .update({
          current_round_id: roundData.id,
          phase: 'betting',
          phase_start_time: new Date().toISOString(),
          current_multiplier: 1.00,
          active_players_count: 0,
          total_bet_amount: 0.00,
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);
    } catch (stateError) {
      await this.logger.error('error updating crash game state', { error: stateError.message });
    }
  }

  async processBet(gameId, userId, betData) {
    // Check if user is banned first
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Check if user is banned
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('banned')
        .eq('id', userId)
        .single();
      
      if (userError) {
        await this.logger.error('error checking user ban status', { error: userError.message });
        return { 
          success: false, 
          message: 'Failed to verify user status' 
        };
      }
      
      if (userData?.banned) {
        await this.logger.warning(`banned user ${userId} attempted to place bet`, { gameId, betData });
        return { 
          success: false, 
          message: 'You are banned from placing bets' 
        };
      }
    } catch (error) {
      await this.logger.error('error checking ban status', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to verify user status' 
      };
    }

    // Handle crash game specially
    if (gameId === 'crash') {
      // Check if we're in betting phase
      if (this.crashState.phase !== 'betting') {
        return { 
          success: false, 
          message: 'Betting is not currently open', 
          phase: this.crashState.phase,
          allowedPhases: ['betting']
        };
      }

      const { amount, betType } = betData;
      
      // Validate bet using GameConfig
      if (!this.validateBet('crash', amount, betType)) {
        const betLimits = this.gameConfig.getBetLimits('crash');
        return { 
          success: false, 
          message: 'Invalid bet amount', 
          minBet: betLimits.min, 
          maxBet: betLimits.max 
        };
      }

      // Use database function to place bet
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        // Call the database function to place bet
        const { data: result, error } = await supabase.rpc('place_crash_bet', {
          p_user_id: userId,
          p_bet_amount: amount,
          p_round_id: this.crashState.currentRoundId
        });
        
        if (error) {
          console.error('error placing crash bet:', error);
          return { 
            success: false, 
            message: error.message || 'Failed to place bet' 
          };
        }
        
        console.log(`bet processed: ${amount} by user ${userId} in crash game`);
        
        return { 
          success: true, 
          message: 'Bet placed successfully',
          betAmount: amount,
          betId: result.bet_id,
          newBalance: result.new_balance,
          gameState: this.crashState
        };
        
      } catch (error) {
        console.error('failed to place crash bet:', error);
        return { 
          success: false, 
          message: 'Failed to place bet' 
        };
      }
    }

    // Handle other games with GameConfig
    const gameState = this.gameStates.get(gameId);
    if (!gameState) {
      return { 
        success: false, 
        message: `Game ${gameId} not found` 
      };
    }

    if (gameState.phase !== 'betting') {
      return { 
        success: false, 
        message: 'Betting is not currently open',
        phase: gameState.phase,
        allowedPhases: ['betting']
      };
    }

    const { amount, betType } = betData;
    
    // Validate bet using GameConfig
    if (!this.validateBet(gameState.gamemode, amount, betType)) {
      const betLimits = this.gameConfig.getBetLimits(gameState.gamemode);
      return { 
        success: false, 
        message: 'Invalid bet amount',
        minBet: betLimits.min,
        maxBet: betLimits.max
      };
    }

    // Add bet to game state
    if (!gameState.bets.has(userId)) {
      gameState.bets.set(userId, []);
    }
    gameState.bets.get(userId).push({
      amount,
      betType,
      timestamp: new Date()
    });

    console.log(`bet processed: ${amount} by user ${userId} in game ${gameId}`);
    
    return { 
      success: true, 
      message: 'Bet placed successfully',
      betAmount: amount,
      gameState: gameState
    };
  }

  // Process game action (cashout, auto-cashout, etc.)
  async processGameAction(gameId, userId, action, targetMultiplier = 1.5) {
    // Handle crash game specially
    if (gameId === 'crash') {
      // Handle auto-cashout regardless of game phase
      if (action === 'auto_cashout') {
        try {
          const { createClient } = require('@supabase/supabase-js');
          const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
          );
          
          // Call the database function to set auto-cashout
          const { data: result, error } = await supabase.rpc('set_crash_auto_cashout', {
            p_user_id: userId,
            p_round_id: this.crashState.currentRoundId,
            p_target_multiplier: targetMultiplier
          });
          
          if (error) {
            console.error('error setting auto-cashout:', error);
            return { 
              success: false, 
              message: error.message || 'Failed to set auto-cashout' 
            };
          }
          
          console.log(`user ${userId} enabled auto-cashout at ${result.target_multiplier}x`);
          return { 
            success: true, 
            action: 'auto_cashout_enabled',
            target_multiplier: result.target_multiplier
          };
        } catch (error) {
          console.error('failed to set auto-cashout:', error);
          return { 
            success: false, 
            message: 'Failed to set auto-cashout' 
          };
        }
      }

      // For cashout action, check if game is playing
      if (action === 'cashout') {
        if (this.crashState.phase !== 'playing') {
          return { 
            success: false, 
            message: 'Cannot cashout - game is not currently playing',
            action: 'cashout_failed'
          };
        }

        try {
          const { createClient } = require('@supabase/supabase-js');
          const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
          );
          
          const currentMultiplier = parseFloat(this.crashState.currentMultiplier);
          
          // Call the database function to cashout
          const { data: result, error } = await supabase.rpc('cashout_crash_bet', {
            p_user_id: userId,
            p_round_id: this.crashState.currentRoundId,
            p_cashout_multiplier: currentMultiplier
          });
          
          if (error) {
            console.error('error cashing out crash bet:', error);
            return { 
              success: false, 
              message: error.message || 'Failed to cashout' 
            };
          }
          
          console.log(`user ${userId} cashed out at ${currentMultiplier}x for ${result.payout_amount} GC`);
          
          return { 
            success: true, 
            payout: result.payout_amount, 
            multiplier: currentMultiplier,
            newBalance: result.new_balance
          };
          
        } catch (error) {
          console.error('failed to cashout crash bet:', error);
          return { 
            success: false, 
            message: 'Failed to cashout' 
          };
        }
      }
      
      // Unknown action for crash
      return { 
        success: false, 
        message: `Unknown game action: ${action}` 
      };
    }

    // Handle other games
    const gameState = this.gameStates.get(gameId);
    if (!gameState) {
      return { 
        success: false, 
        message: `Game ${gameId} not found` 
      };
    }

    if (gameState.phase !== 'playing') {
      return { 
        success: false, 
        message: 'Game is not currently playing' 
      };
    }

    // Handle different game actions
    switch (action) {
      case 'cashout':
        // Process cashout for crash game
        if (gameState.gamemode === 'crash') {
          const userBets = gameState.bets.get(userId) || [];
          const activeBet = userBets.find(bet => bet.status === 'active');
          
          if (activeBet) {
            const currentMultiplier = this.crashState.currentMultiplier;
            const payout = activeBet.amount * currentMultiplier;
            
            // Mark bet as cashed out
            activeBet.status = 'cashed_out';
            activeBet.cashoutMultiplier = currentMultiplier;
            activeBet.payout = payout;
            
            console.log(`user ${userId} cashed out at ${currentMultiplier}x for ${payout} GC`);
            
            return { 
              success: true, 
              payout: payout, 
              multiplier: currentMultiplier 
            };
          } else {
            return { 
              success: false, 
              message: 'No active bet to cashout' 
            };
          }
        }
        break;
        
      default:
        return { 
          success: false, 
          message: `Unknown game action: ${action}` 
        };
    }
  }

  // Execute game logic and determine result
  async executeGameLogic(gameId) {
    const gameState = this.gameStates.get(gameId);
    if (!gameState) {
      throw new Error(`Game ${gameId} not found`);
    }

    console.log(`executing game logic for ${gameState.gamemode}: ${gameId}`);
    
    // Change phase to playing
    gameState.phase = 'playing';
    gameState.startTime = new Date();
    
    // TODO: Implement gamemode-specific logic
    // For now, just simulate a basic result
    const result = this.simulateGameResult(gameState.gamemode);
    
    // Change phase to results
    gameState.phase = 'results';
    gameState.endTime = new Date();
    gameState.result = result;
    
    return result;
  }

  // Handle game completion
  async completeGame(gameId) {
    const gameState = this.gameStates.get(gameId);
    if (!gameState) {
      throw new Error(`Game ${gameId} not found`);
    }

    console.log(`completing game ${gameId}`);
    
    // Process payouts
    const payouts = this.calculatePayouts(gameState);
    
    // Clean up game state
    this.activeGames.delete(gameId);
    
    return {
      gameId,
      payouts,
      result: gameState.result
    };
  }

  // Get current game state
  getGameState(gameId) {
    return this.gameStates.get(gameId);
  }

  // Get crash game state
  async getCrashGameState(userId = null) {
    // If no user ID provided, return basic state
    if (!userId) {
      return this.crashState;
    }

    // Get state with user's bet from database
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data: result, error } = await supabase.rpc('get_crash_game_state_with_user_bet', {
        p_user_id: userId
      });
      
      if (error) {
        console.error('error getting crash game state with user bet:', error);
        return this.crashState;
      }
      
      // Merge database state with in-memory state, prioritizing in-memory for real-time data
      return {
        ...this.crashState, // Keep all in-memory state (phase, multiplier, etc.)
        current_user_bet: result.current_user_bet, // Add user's bet from database
        active_bets: result.active_bets, // Add active bets from database
        current_round: result.current_round, // Add round info from database
        // Keep in-memory values for real-time data
        phase: this.crashState.phase,
        currentMultiplier: this.crashState.currentMultiplier,
        phaseStartTime: this.crashState.phaseStartTime,
        activePlayersCount: this.crashState.activePlayersCount,
        totalBetAmount: this.crashState.totalBetAmount
      };
    } catch (error) {
      console.error('error in getCrashGameState:', error);
      return this.crashState;
    }
  }

  // Get crash history for live history bar
  async getCrashHistory(limit = 20) {
    if (!this.databaseService) {
      return [];
    }

    try {
      const { data, error } = await this.databaseService.supabase
        .from('crash_rounds')
        .select('round_number, crash_multiplier, phase')
        .eq('phase', 'completed')
        .order('round_number', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('error fetching crash history:', error);
        return [];
      }

      // Reverse to get chronological order (oldest to newest)
      return data ? data.reverse() : [];
    } catch (error) {
      console.error('error in getCrashHistory:', error);
      return [];
    }
  }

  // Update game state
  updateGameState(gameId, newState) {
    const currentState = this.gameStates.get(gameId);
    if (currentState) {
      this.gameStates.set(gameId, { ...currentState, ...newState });
    }
  }

  // Validate bet
  validateBet(gamemode, amount, betType) {
    // Basic validation
    if (amount <= 0) return false;
    
    // Get bet limits from GameConfig
    const betLimits = this.gameConfig.getBetLimits(gamemode);
    if (amount < betLimits.min || amount > betLimits.max) {
      return false;
    }
    
    // TODO: Add gamemode-specific validation
    return true;
  }

  // Simulate game result (placeholder)
  simulateGameResult(gamemode) {
    switch (gamemode) {
      case 'blackjack':
        return { winner: 'player', payout: 1.5 };
      case 'roulette':
        return { number: Math.floor(Math.random() * 37), payout: 2.0 };
      case 'crash':
        return { multiplier: 1.5, crashed: false };
      case 'slots':
        return { symbols: ['🍒', '🍊', '🍇'], payout: 0 };
      case 'hi-lo':
        return { correct: true, streak: 1 };
      default:
        return { winner: 'house', payout: 0 };
    }
  }

  // Calculate payouts
  calculatePayouts(gameState) {
    const payouts = new Map();
    
    for (const [userId, bets] of gameState.bets) {
      let totalPayout = 0;
      
      for (const bet of bets) {
        // TODO: Implement proper payout calculation based on game result
        const payout = bet.amount * (gameState.result.payout || 0);
        totalPayout += payout;
      }
      
      if (totalPayout > 0) {
        payouts.set(userId, totalPayout);
      }
    }
    
    return payouts;
  }

  // Get all active games
  getActiveGames() {
    return Array.from(this.activeGames);
  }

  // Clean up completed games
  cleanupCompletedGames() {
    const now = new Date();
    const completedGames = [];
    
    for (const gameId of this.activeGames) {
      const gameState = this.gameStates.get(gameId);
      if (gameState && gameState.phase === 'results') {
        // Game has been in results phase for too long
        const timeSinceEnd = now - gameState.endTime;
        if (timeSinceEnd > 30000) { // 30 seconds
          completedGames.push(gameId);
        }
      }
    }
    
    for (const gameId of completedGames) {
      this.gameStates.delete(gameId);
      this.activeGames.delete(gameId);
    }
    
    return completedGames;
  }

  // Generate crash point with house edge
  generateCrashPoint() {
    // Use the hash to generate deterministic crash point
    return this.generateCrashPointFromHash(this.crashState.currentRoundId);
  }

  // Generate crash point from hash using proper crash equation
  generateCrashPointFromHash(hash, div = 33, g = 1) {
    const e = Math.pow(2, 52); // Extreme value
    const hashBuffer = Buffer.from(hash, 'hex');
    
    // Generate a proper random number from the hash (like Python's random.uniform)
    // Use multiple bytes to get better distribution
    let h = 0;
    for (let i = 0; i < Math.min(hashBuffer.length, 8); i++) {
      h = (h * 256 + hashBuffer[i]) % e;
    }
    
    // Apply growth rate validation (like Python's checkg function)
    g = Math.max(0.1, Math.round(g * 10) / 10);
    if (g === 0) g = 1;
    
    // Apply divisor validation (like Python's checkdiv function)
    div = Math.max(1, Math.round(div * 100) / 100);
    
    // Check for instant crash (1x) - same as Python logic
    if (h % div === 0) {
      return 1.00;
    }
    
    // Calculate crash point using the exact same equation as Python
    let crashPoint = 0.99 * Math.pow(e / (e - h), 1/g) + 0.01;
    
    // Apply house edge from GameConfig
    const houseEdge = this.gameConfig.getHouseEdge('crash');
    crashPoint = crashPoint * (1 - houseEdge);
    
    return Math.max(1.00, parseFloat(crashPoint.toFixed(2)));
  }

  // Verify crash point from hash (for player verification)
  verifyCrashPointFromHash(hash, expectedCrashPoint, div = 33, g = 1) {
    const calculatedCrashPoint = this.generateCrashPointFromHash(hash, div, g);
    return {
      verified: Math.abs(calculatedCrashPoint - expectedCrashPoint) < 0.01,
      calculated: calculatedCrashPoint,
      expected: expectedCrashPoint,
      hash: hash
    };
  }

  // Start a game with timing
  async startGame(gameId) {
    const gameState = this.gameStates.get(gameId);
    if (!gameState) {
      return { success: false, message: 'Game not found' };
    }

    const timing = gameState.config.timing;
    const now = Date.now();

    // Start betting phase
    gameState.phase = 'betting';
    gameState.phaseStartTime = now;
    gameState.phaseEndTime = now + timing.bettingPhase;
    gameState.startTime = now;

    console.log(`Started ${gameState.gamemode} game ${gameId} - betting phase for ${timing.bettingPhase}ms`);

    // Schedule phase transitions
    setTimeout(() => {
      this.startGamePhase(gameId);
    }, timing.bettingPhase);

    return { success: true, message: 'Game started', gameState };
  }

  // Start game phase (after betting)
  async startGamePhase(gameId) {
    const gameState = this.gameStates.get(gameId);
    if (!gameState || gameState.phase !== 'betting') {
      return;
    }

    const timing = gameState.config.timing;
    const now = Date.now();

    // Start game phase
    gameState.phase = 'playing';
    gameState.phaseStartTime = now;
    gameState.phaseEndTime = now + timing.gamePhase;

    console.log(`Started ${gameState.gamemode} game ${gameId} - playing phase for ${timing.gamePhase}ms`);

    // Execute game logic
    await this.executeGameLogic(gameId);

    // Schedule results phase
    setTimeout(() => {
      this.startResultsPhase(gameId);
    }, timing.gamePhase);
  }

  // Start results phase
  async startResultsPhase(gameId) {
    const gameState = this.gameStates.get(gameId);
    if (!gameState || gameState.phase !== 'playing') {
      return;
    }

    const timing = gameState.config.timing;
    const now = Date.now();

    // Start results phase
    gameState.phase = 'results';
    gameState.phaseStartTime = now;
    gameState.phaseEndTime = now + timing.resultPhase;

    console.log(`Started ${gameState.gamemode} game ${gameId} - results phase for ${timing.resultPhase}ms`);

    // Complete the game
    await this.completeGame(gameId);

    // Schedule cleanup
    setTimeout(() => {
      this.cleanupCompletedGames();
    }, timing.resultPhase);
  }

  // Stop crash game loop
  stopCrashGameLoop() {
    if (this.crashGameLoop) {
      clearInterval(this.crashGameLoop);
      this.crashGameLoop = null;
    }
  }

  // Validate chat message using GameConfig
  validateChatMessage(message, userId) {
    const chatSettings = this.gameConfig.getChatSettings();
    
    // Check message length
    if (message.length > chatSettings.maxMessageLength) {
      return {
        valid: false,
        error: `Message too long. Maximum ${chatSettings.maxMessageLength} characters allowed.`
      };
    }

    // Check if user has sent a message recently (rate limiting)
    const now = Date.now();
    const userLastMessage = this.userLastMessageTime.get(userId);
    
    if (userLastMessage && (now - userLastMessage) < chatSettings.messageRateLimit) {
      return {
        valid: false,
        error: `Please wait ${Math.ceil((chatSettings.messageRateLimit - (now - userLastMessage)) / 1000)} seconds before sending another message.`
      };
    }

    // Update last message time
    this.userLastMessageTime.set(userId, now);

    return { valid: true };
  }

  // Get chat history with GameConfig limits
  getChatHistory(gameId, limit = null) {
    const chatSettings = this.gameConfig.getChatSettings();
    const maxHistory = limit || chatSettings.maxHistoryLength;
    
    const gameState = this.gameStates.get(gameId);
    if (!gameState || !gameState.chatHistory) {
      return [];
    }

    // Return last N messages
    return gameState.chatHistory.slice(-maxHistory);
  }

  // Add chat message with validation
  addChatMessage(gameId, userId, message, username = 'Anonymous') {
    const validation = this.validateChatMessage(message, userId);
    if (!validation.valid) {
      return validation;
    }

    const gameState = this.gameStates.get(gameId);
    if (!gameState) {
      return { valid: false, error: 'Game not found' };
    }

    // Initialize chat history if not exists
    if (!gameState.chatHistory) {
      gameState.chatHistory = [];
    }

    const chatMessage = {
      id: Date.now() + Math.random(),
      userId,
      username,
      message,
      timestamp: new Date().toISOString()
    };

    // Add message to history
    gameState.chatHistory.push(chatMessage);

    // Trim history to max length
    const chatSettings = this.gameConfig.getChatSettings();
    if (gameState.chatHistory.length > chatSettings.maxHistoryLength) {
      gameState.chatHistory = gameState.chatHistory.slice(-chatSettings.maxHistoryLength);
    }

    return { valid: true, message: chatMessage };
  }

  // Get GameConfig instance
  getGameConfig() {
    return this.gameConfig;
  }

  // Get bet limits for a gamemode
  getBetLimits(gamemode) {
    return this.gameConfig.getBetLimits(gamemode);
  }

  // Get house edge for a gamemode
  getHouseEdge(gamemode) {
    return this.gameConfig.getHouseEdge(gamemode);
  }

  // Get game timing settings
  getGameTiming() {
    return this.gameConfig.getGameTiming();
  }

  // Get chat settings
  getChatSettings() {
    return this.gameConfig.getChatSettings();
  }

  // Get balance limits
  getBalanceLimits() {
    return this.gameConfig.getBalanceLimits();
  }

  // Update game configuration
  updateGameConfig(newConfig) {
    return this.gameConfig.updateConfig(newConfig);
  }

  // Load game configuration from database
  async loadGameConfig() {
    return await this.gameConfig.loadConfig();
  }

  // Save game configuration to database
  async saveGameConfig() {
    return await this.gameConfig.saveConfig();
  }

  // Get all game configuration
  getAllGameConfig() {
    return this.gameConfig.getAllConfig();
  }

  // Reset game configuration to defaults
  resetGameConfig() {
    return this.gameConfig.resetConfig();
  }
}

module.exports = GameLoopEngine; 