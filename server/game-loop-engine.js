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
    
    // Add flags to prevent duplicate logging
    this.lastRoundCompleted = null; // Track last completed round to prevent duplicate logs
    this.isStartingNewRound = false; // Prevent multiple calls to startNewCrashRound
    this.lastProcessedRound = null; // Track last processed round to prevent duplicate processing
    this.lastConfigReload = Date.now(); // Set to current time to prevent immediate reload
    this.configReloadInterval = 300000; // 5 minutes instead of 2 minutes
    this._hasStartedReloadCycle = false; // Track if we've started the reload cycle
    
    // Enhanced auto-cashout processing with better timing
    this.lastAutoCashoutCheck = 0; // Track last auto-cashout check time
    
    // Create reusable Supabase client to prevent memory leaks
    const { createClient } = require('@supabase/supabase-js');
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Crash game specific state
    this.crashState = {
      phase: 'waiting', // waiting, betting, playing, crashed
      currentRoundId: null,
      currentMultiplier: 1.00,
      phaseStartTime: Date.now(),
      resultPhaseStartTime: null, // Track result phase timing separately
      activePlayersCount: 0,
      totalBetAmount: 0.00,
      currentCrashPoint: 1.00,
      currentRoundNumber: 1,
      gameHash: null, // Add hash for transparency
      serverSeed: null, // Add server seed for transparency
      clientSeed: null // Add client seed for transparency
    };
    
    this.crashGameLoop = null;
    this.cleanupInterval = null;
    
    // Initialize crash in the generic game system using GameConfig
    const crashConfig = this.gameConfig.getBetLimits('crash');
    const crashHouseEdge = this.gameConfig.getHouseEdge('crash');
    this.initializeGame('crash', 'crash-main', {
      minBet: crashConfig.min,
      maxBet: crashConfig.max,
      houseEdge: crashHouseEdge
    });
    
    // Start periodic cleanup to prevent memory leaks
    this.startCleanupInterval();
    
    // Load game config once during initialization
    this.gameConfig.loadConfig().then(() => {
      console.log('Game configuration loaded during initialization');
      this._hasStartedReloadCycle = true; // Prevent immediate reload
    }).catch((error) => {
      console.error('Error loading game config during initialization:', error);
      this._hasStartedReloadCycle = true; // Prevent immediate reload even on error
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
      
      // Clean up completed games older than 30 minutes
      const thirtyMinutesAgo = now - (30 * 60 * 1000);
      for (const [gameId, gameState] of this.gameStates.entries()) {
        if (gameState.phase === 'results' && gameState.endTime && gameState.endTime.getTime() < thirtyMinutesAgo) {
          this.gameStates.delete(gameId);
          this.activeGames.delete(gameId);
        }
      }
      
      // Force garbage collection if memory usage is high
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      
      // If heap usage is over 100MB, force garbage collection
      if (heapUsedMB > 100) {
        if (global.gc) {
          global.gc();
          console.log(`Forced garbage collection at ${heapUsedMB}MB heap usage`);
        }
      }
      
      // Log cleanup stats and memory usage
      if (this.userLastMessageTime.size > 1000 || this.gameStates.size > 50) {
        this.logger.info(`memory cleanup completed - userLastMessageTime: ${this.userLastMessageTime.size}, gameStates: ${this.gameStates.size}, heapUsed: ${heapUsedMB}MB`);
      }
    } catch (error) {
      this.logger.error('error during memory cleanup:', error);
    }
  }

  // Initialize a new game session
  initializeGame(gamemode, gameId, config = null) {
    // Only log once per game type to prevent spam
    if (!this._initializedGames) {
      this._initializedGames = new Set();
    }
    
    if (!this._initializedGames.has(gamemode)) {
      console.log(`initializing ${gamemode} game: ${gameId}`);
      this._initializedGames.add(gamemode);
    }
    
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
      config: gameConfig
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
    // Only initialize once to prevent spam
    if (this._crashInitialized) {
      return;
    }
    this._crashInitialized = true;
    
    // Check if there's already an active round - don't create a new one if there is
    const { data: existingActiveRound, error: activeRoundError } = await this.supabase
      .from('crash_rounds')
      .select('id, round_number, crash_multiplier, phase')
      .eq('phase', 'active')
      .order('id', { ascending: false })
      .limit(1)
      .single();
    
    if (!activeRoundError && existingActiveRound) {
      console.log(`Found existing active round ${existingActiveRound.round_number}, using it instead of creating new one`);
      
      // Use the existing active round
      this.crashState.currentRoundId = existingActiveRound.id;
      this.crashState.currentRoundNumber = existingActiveRound.round_number;
      this.crashState.phase = 'active';
      this.crashState.phaseStartTime = Date.now();
      this.crashState.currentCrashPoint = existingActiveRound.crash_multiplier;
      
      // Update game state to use existing round
      await this.supabase
        .from('crash_game_state')
        .upsert({
          id: 1,
          current_round_id: existingActiveRound.id,
          phase: 'active',
          phase_start_time: new Date().toISOString(),
          current_multiplier: 1.00,
          active_players_count: 0,
          total_bet_amount: 0.00,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });
      
      console.log('Using existing active round, not creating new one');
      this.startCrashGameLoop();
      return;
    }
    
    // Only create new round if no active round exists
    const crypto = require('crypto');
    const serverSeed = crypto.randomBytes(32).toString('hex');
    
    const { data: roundId, error: roundError } = await this.supabase.rpc('create_crash_round', {
      p_server_seed: serverSeed,
      p_client_seed: 'default'
    });
    
    if (roundError) {
      console.error('error creating initial crash round:', roundError);
      return;
    }
    
    // Check if game state exists, if not reset everything
    const { data: existingStates, error: stateCheckError } = await this.supabase
      .from('crash_game_state')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    
    if (stateCheckError || !existingStates || existingStates.length === 0) {
      console.log('crash game state missing, resetting rounds...');
      try {
        await this.supabase.rpc('reset_crash_rounds');
        console.log('crash rounds reset successfully');
      } catch (resetError) {
        console.error('error resetting crash rounds:', resetError);
      }
    }
    
    // Get the created round to get the correct round number
    const { data: roundData, error: fetchError } = await this.supabase
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
      // Get the latest game state ID or create a new one
      const { data: latestState } = await this.supabase
        .from('crash_game_state')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .single();
      
      const stateId = latestState ? latestState.id : 1;
      
      await this.supabase
        .from('crash_game_state')
        .upsert({
          id: stateId,
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
    // Clear any existing loop to prevent duplicates
    if (this.crashGameLoop) {
      clearInterval(this.crashGameLoop);
    }
    
    this.crashGameLoop = setInterval(async () => {
      try {
        await this.updateCrashGameLoop();
      } catch (error) {
        console.error('error in crash game loop:', error);
        // Don't let errors crash the game loop
      }
    }, 16); // Optimized to 16ms (60 FPS) for industry-standard performance
  }

  // Update crash game loop
  async updateCrashGameLoop() {
    const timeElapsed = (Date.now() - this.crashState.phaseStartTime) / 1000.0;
    
    // Only reload game config every 5 minutes to avoid excessive database calls
    const now = Date.now();
    if (!this.lastConfigReload || (now - this.lastConfigReload) > this.configReloadInterval) {
      try {
        await this.gameConfig.loadConfig();
        this.lastConfigReload = now;
        // Only log once per reload cycle, not on startup
        if (this._hasStartedReloadCycle) {
          console.log('Game configuration reloaded from database (5-minute cycle)');
        } else {
          this._hasStartedReloadCycle = true;
        }
      } catch (error) {
        // Silent error handling - no logging
        // console.error('Error reloading game config:', error);
      }
    }
    
    const gameTiming = this.gameConfig.getGameTiming();

          // Process auto-cashouts with high-frequency checks for accuracy
          if (this.crashState.phase === 'playing') {
            // Check every 8ms (120 FPS) for maximum accuracy
            const now = Date.now();
            if (now - this.lastAutoCashoutCheck >= 8) {
              await this.processAutoCashouts();
              this.lastAutoCashoutCheck = now;
            }
          }

    if (this.crashState.phase === 'betting') {
      // Start game after betting phase duration from GameConfig
      if (timeElapsed > (gameTiming.bettingPhase / 1000)) {
        await this.startCrashGame();
      }
    } else if (this.crashState.phase === 'playing') {
      // Update multiplier with higher precision to avoid rounding errors
      this.crashState.currentMultiplier = parseFloat((1.0024 * Math.pow(1.0718, timeElapsed)).toFixed(4));
      
      // Update database state every 1 second to balance accuracy and performance
      if (Math.floor(timeElapsed) !== Math.floor((timeElapsed - 1))) {
        try {
          await this.supabase
            .from('crash_game_state')
            .update({
              current_multiplier: this.crashState.currentMultiplier,
              updated_at: new Date().toISOString()
            })
            .eq('id', 1);
        } catch (error) {
          console.error('error updating crash game state:', error);
        }
      }
      
      // Check if crashed - only handle once per round
      // Use same precision for both values to avoid comparison issues
      const currentMultiplier = parseFloat(this.crashState.currentMultiplier);
      const crashPoint = parseFloat(this.crashState.currentCrashPoint);
      
      if (currentMultiplier >= crashPoint && 
          this.crashState.phase === 'playing' && 
          this.lastProcessedRound !== this.crashState.currentRoundId) {
        
        // Set the final multiplier to exactly the crash point with proper precision
        this.crashState.currentMultiplier = this.crashState.currentCrashPoint;
        
        // Immediately update database with final crash value
        try {
          await this.supabase
            .from('crash_game_state')
            .update({
              current_multiplier: this.crashState.currentCrashPoint,
              updated_at: new Date().toISOString()
            })
            .eq('id', 1);
        } catch (error) {
          console.error('error updating final crash multiplier:', error);
        }
        
        // Broadcast final crash value immediately to all clients
        if (global.serverInstance && global.serverInstance.wsServer) {
          global.serverInstance.wsServer.broadcastToRoom('crash', {
            type: 'crash_final_value',
            crashPoint: this.crashState.currentCrashPoint,
            roundNumber: this.crashState.currentRoundNumber,
            timestamp: new Date().toISOString()
          });
        }
        
        // Only handle crash once by setting phase to crashed
        this.crashState.phase = 'crashed';
        this.crashState.resultPhaseStartTime = Date.now(); // Set result phase start time immediately
        await this.handleCrashGame();
      }
    } else if (this.crashState.phase === 'crashed') {
      // Start new round after result phase duration from GameConfig
      const resultPhaseDuration = gameTiming.resultPhase / 1000;
      const resultPhaseElapsed = this.crashState.resultPhaseStartTime 
        ? (Date.now() - this.crashState.resultPhaseStartTime) / 1000.0 
        : 0;
      
      if (resultPhaseElapsed > resultPhaseDuration && !this.isStartingNewRound) {
        this.isStartingNewRound = true;
        await this.startNewCrashRound();
        this.isStartingNewRound = false;
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
    
    // Auto-cashouts will be processed by the enhanced database function
  }

  // Handle crash game end
  async handleCrashGame() {
    // Only process each round once
    if (this.lastProcessedRound === this.crashState.currentRoundId) {
      return;
    }
    
    // Log the game end
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
            crash_multiplier: parseFloat(this.crashState.currentCrashPoint).toFixed(4),
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
    // Only process each round once
    if (this.lastProcessedRound === this.crashState.currentRoundId) {
      return;
    }
    
    // Update bet status to crashed for all active players
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Use the database round ID
    const roundId = this.crashState.currentRoundId;
    
    try {
      // First, count how many active bets we're about to update
      const { count: activeBetsCount } = await supabase
        .from('crash_bets')
        .select('*', { count: 'exact', head: true })
        .eq('round_id', roundId)
        .eq('status', 'active');
      
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
        // Only log if we actually processed bets and haven't logged this round yet
        if (activeBetsCount && activeBetsCount > 0) {
          await this.logger.info(`updated ${activeBetsCount} remaining crash bets to crashed status`);
        }
        this.lastProcessedRound = roundId; // Mark this round as processed
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
    
    // Complete the previous round first
    if (this.crashState.currentRoundId) {
      try {
        await this.supabase
          .from('crash_rounds')
          .update({
            phase: 'completed',
            end_time: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', this.crashState.currentRoundId);
        
        // Only log if this round hasn't been logged yet
        if (this.lastRoundCompleted !== this.crashState.currentRoundId) {
          await this.logger.info(`completed crash round ${this.crashState.currentRoundNumber} at ${this.crashState.currentCrashPoint}x`);
          this.lastRoundCompleted = this.crashState.currentRoundId;
          
          // Broadcast round completion to all users
          if (global.serverInstance && global.serverInstance.wsServer) {
            global.serverInstance.wsServer.broadcastToRoom('crash', {
              type: 'round_completed',
              roundNumber: this.crashState.currentRoundNumber,
              crashPoint: this.crashState.currentCrashPoint,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        await this.logger.error('error completing previous crash round', { error: error.message });
      }
    }
    
    const crypto = require('crypto');
    const serverSeed = crypto.randomBytes(32).toString('hex');
    
    const { data: roundId, error: roundError } = await this.supabase.rpc('create_crash_round', {
      p_server_seed: serverSeed,
      p_client_seed: 'default'
    });
    
    if (roundError) {
      await this.logger.error('error creating new crash round', { error: roundError.message });
      return;
    }
    
    // Get the created round to get the correct round number
    const { data: roundData, error: fetchError } = await this.supabase
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
      await this.supabase
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
      // Check if user is banned
      const { data: userData, error: userError } = await this.supabase
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
      const { amount, betType } = betData;
      
      // Validate bet using enhanced validation
      const validation = await this.validateBet('crash', amount, betType, userId);
      if (!validation.valid) {
        return { 
          success: false, 
          message: validation.message,
          phase: validation.phase,
          minBet: validation.minBet,
          maxBet: validation.maxBet
        };
      }

              // Use database function to place bet
        try {
          // Call the database function to place bet
          const { data: result, error } = await this.supabase.rpc('place_crash_bet', {
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
        message: `Game ${gameId} is not available`
      };
    }

    // Validate bet using GameConfig
    const { amount, betType } = betData;
    if (!this.validateBet(gameId, amount, betType)) {
      const betLimits = this.gameConfig.getBetLimits(gameId);
      return { 
        success: false, 
        message: 'Invalid bet amount', 
        minBet: betLimits.min, 
        maxBet: betLimits.max 
      };
    }

    // Place bet using database function
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Call the database function to place bet
      const { data: result, error } = await supabase.rpc('place_game_bet', {
        p_user_id: userId,
        p_game_id: gameId,
        p_bet_amount: amount,
        p_bet_type: betType
      });
      
      if (error) {
        console.error('error placing bet:', error);
        return { 
          success: false, 
          message: error.message || 'Failed to place bet' 
        };
      }
      
      console.log(`bet processed: ${amount} by user ${userId} in ${gameId} game`);
      
      return { 
        success: true, 
        message: 'Bet placed successfully',
        betAmount: amount,
        betId: result.bet_id,
        newBalance: result.new_balance,
        gameState: gameState
      };
      
    } catch (error) {
      console.error('failed to place bet:', error);
      return { 
        success: false, 
        message: 'Failed to place bet' 
      };
    }
  }

  async validateBet(gameId, amount, betType, userId = null) {
    // Check bet limits
    const betLimits = this.gameConfig.getBetLimits(gameId);
    if (amount < betLimits.min || amount > betLimits.max) {
      return { valid: false, message: `Bet amount must be between ${betLimits.min} and ${betLimits.max}`, minBet: betLimits.min, maxBet: betLimits.max };
    }
    
    // For crash game, check additional validations
    if (gameId === 'crash') {
      // Check if we're in betting phase
      if (this.crashState.phase !== 'betting') {
        return { valid: false, message: 'Betting is not currently open', phase: this.crashState.phase };
      }
      
      // Check if user already has a bet for this round
      if (userId) {
        try {
          const { data: existingBet, error } = await this.supabase
            .from('crash_bets')
            .select('id')
            .eq('user_id', userId)
            .eq('round_id', this.crashState.currentRoundId)
            .single();
          
          if (!error && existingBet) {
            return { valid: false, message: 'You already have a bet for this round' };
          }
        } catch (error) {
          console.error('Error checking existing bet:', error);
          return { valid: false, message: 'Failed to validate bet' };
        }
      }
    }
    
    return { valid: true };
  }

  async getGameState(gameId) {
    return this.gameStates.get(gameId) || null;
  }

  async getCrashState() {
    return this.crashState;
  }

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
    return this.gameConfig.saveConfig();
  }

  resetGameConfig() {
    return this.gameConfig.resetConfig();
  }

  getAllGameConfig() {
    return this.gameConfig.getAllConfig();
  }

  async getCrashGameState(userId) {
    // Return the current crash state with user-specific information
    const state = { ...this.crashState };
    
    // Add user-specific bet information if available
    if (userId && userId !== 'anonymous') {
      try {
        // Get user's current bet for this round
        const { data: userBet, error } = await this.supabase
          .from('crash_bets')
          .select('*')
          .eq('user_id', userId)
          .eq('round_id', this.crashState.currentRoundId)
          .single();
        
        if (!error && userBet) {
          state.userBet = {
            amount: userBet.bet_amount,
            betId: userBet.id,
            placedAt: userBet.created_at
          };
        }
      } catch (error) {
        console.error('Error getting user bet:', error);
      }
    }
    
    return state;
  }

  async getCrashHistory(limit = 20) {
    try {
      // Get recent crash rounds
      const { data: rounds, error } = await this.supabase
        .from('crash_rounds')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        console.error('Error getting crash history:', error);
        return [];
      }
      
      return rounds || [];
    } catch (error) {
      console.error('Error getting crash history:', error);
      return [];
    }
  }

  async processGameAction(gamemode, userId, action, targetMultiplier = null) {
    try {
      if (gamemode === 'crash') {
        return await this.processCrashGameAction(userId, action, targetMultiplier);
      }
      
      return { 
        success: false, 
        message: `Game action not supported for ${gamemode}` 
      };
    } catch (error) {
      console.error('Error processing game action:', error);
      return { 
        success: false, 
        message: 'Failed to process game action' 
      };
    }
  }

  async processCrashGameAction(userId, action, targetMultiplier = null) {
    try {

      if (action === 'cashout') {
        // Check if we're in playing phase
        if (this.crashState.phase !== 'playing') {
          return { 
            success: false, 
            message: 'Cashout is only available during the playing phase' 
          };
        }

        // Check if user has an active bet
        const { data: userBet, error: betError } = await this.supabase
          .from('crash_bets')
          .select('*')
          .eq('user_id', userId)
          .eq('round_id', this.crashState.currentRoundId)
          .eq('status', 'active')
          .single();

        if (betError || !userBet) {
          return { 
            success: false, 
            message: 'No active bet found to cashout' 
          };
        }

        // Calculate cashout amount based on current multiplier
        const cashoutMultiplier = parseFloat(this.crashState.currentMultiplier);
        const cashoutAmount = userBet.bet_amount * cashoutMultiplier;

        // Process cashout using database function
        const { data: result, error: cashoutError } = await this.supabase.rpc('cashout_crash_bet', {
          p_user_id: userId,
          p_round_id: this.crashState.currentRoundId,
          p_cashout_multiplier: cashoutMultiplier
        });

        if (cashoutError) {
          console.error('Error processing cashout:', cashoutError);
          return { 
            success: false, 
            message: cashoutError.message || 'Failed to process cashout' 
          };
        }

        console.log(`cashout processed: ${cashoutAmount} by user ${userId} at ${cashoutMultiplier}x`);

        return { 
          success: true, 
          message: 'Cashout successful',
          cashoutAmount: cashoutAmount,
          cashoutMultiplier: cashoutMultiplier,
          newBalance: result.new_balance,
          betId: result.bet_id
        };
      }

      if (action === 'auto_cashout') {
        // Check if we're in betting or playing phase
        if (this.crashState.phase !== 'betting' && this.crashState.phase !== 'playing') {
          return { 
            success: false, 
            message: 'Auto-cashout can only be set during betting or playing phase' 
          };
        }

        // Validate target multiplier
        if (!targetMultiplier || targetMultiplier < 1.0) {
          return { 
            success: false, 
            message: 'Invalid target multiplier. Must be at least 1.0x' 
          };
        }

        // Check if user has an active bet
        const { data: userBet, error: betError } = await this.supabase
          .from('crash_bets')
          .select('*')
          .eq('user_id', userId)
          .eq('round_id', this.crashState.currentRoundId)
          .eq('status', 'active')
          .single();

        if (betError || !userBet) {
          return { 
            success: false, 
            message: 'No active bet found to set auto-cashout for' 
          };
        }

        // Set auto-cashout using database function
        const { data: result, error: autoCashoutError } = await this.supabase.rpc('set_crash_auto_cashout', {
          p_user_id: userId,
          p_round_id: this.crashState.currentRoundId,
          p_target_multiplier: targetMultiplier
        });

        if (autoCashoutError) {
          console.error('Error setting auto-cashout:', autoCashoutError);
          return { 
            success: false, 
            message: autoCashoutError.message || 'Failed to set auto-cashout' 
          };
        }

        console.log(`Auto-cashout set: ${targetMultiplier}x for user ${userId}`);

        return { 
          success: true, 
          message: 'Auto-cashout set successfully',
          targetMultiplier: targetMultiplier,
          result: result
        };
      }

      return { 
        success: false, 
        message: `Unknown action: ${action}` 
      };
    } catch (error) {
      console.error('Error processing crash game action:', error);
      return { 
        success: false, 
        message: 'Failed to process game action' 
      };
    }
  }

  getMemoryStats() {
    // Get Node.js memory usage
    const memUsage = process.memoryUsage();
    
    const stats = {
      // Node.js memory statistics
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100), // Percentage
        memoryEfficiency: Math.round((memUsage.heapUsed / memUsage.rss) * 100) // Percentage
      },
      // Game engine statistics
      games: this.gameStates.size,
      activeGames: this.activeGames.size,
      crashState: {
        phase: this.crashState.phase,
        currentRoundId: this.crashState.currentRoundId,
        currentMultiplier: this.crashState.currentMultiplier,
        currentCrashPoint: this.crashState.currentCrashPoint,
        currentRoundNumber: this.crashState.currentRoundNumber,
        activePlayersCount: this.crashState.activePlayersCount,
        totalBetAmount: this.crashState.totalBetAmount
      },
      userConnections: this.userLastMessageTime.size,
      lastProcessedRound: this.lastProcessedRound,
      lastRoundCompleted: this.lastRoundCompleted,
      isStartingNewRound: this.isStartingNewRound,
      configReloadInterval: this.configReloadInterval,
      lastConfigReload: this.lastConfigReload,
      _hasStartedReloadCycle: this._hasStartedReloadCycle
    };
    
    return stats;
  }

  async stopGame(gameId) {
    const gameState = this.gameStates.get(gameId);
    if (gameState) {
      gameState.isRunning = false;
      this.gameStates.delete(gameId);
    }
  }

  async stopAllGames() {
    for (const [gameId, gameState] of this.gameStates) {
      gameState.isRunning = false;
    }
    this.gameStates.clear();
    
    if (this.crashState.isRunning) {
      this.crashState.isRunning = false;
    }
  }

  // Enhanced auto-cashout processing with high-frequency checks
  async processAutoCashouts() {
    try {
      // Only process if we have a valid round ID and are in playing phase
      if (!this.crashState.currentRoundId || this.crashState.phase !== 'playing') {
        return;
      }

      const currentMultiplier = parseFloat(this.crashState.currentMultiplier);
      
      // Process auto-cashouts using the enhanced database function
      const { data: autoCashoutResult, error: autoCashoutError } = await this.supabase.rpc('process_crash_auto_cashouts', {
        p_round_id: this.crashState.currentRoundId,
        p_current_multiplier: currentMultiplier
      });
      
      if (autoCashoutError) {
        console.error('Auto-cashout error:', autoCashoutError);
        return;
      }
      
      // If auto-cashouts were processed, send notifications to affected users
      if (autoCashoutResult && autoCashoutResult.processed_count > 0) {
        console.log(`Processed ${autoCashoutResult.processed_count} auto-cashouts`);
        
        // Send individual notifications to each user who was auto-cashed out
        if (autoCashoutResult.processed_users && global.serverInstance && global.serverInstance.wsServer) {
          for (const userCashout of autoCashoutResult.processed_users) {
            // Validate and format the data to prevent undefined values
            const cashoutMultiplier = parseFloat(userCashout.cashout_multiplier) || 0;
            const cashoutAmount = parseFloat(userCashout.cashout_amount) || 0;
            const betAmount = parseFloat(userCashout.bet_amount) || 0;
            
            global.serverInstance.wsServer.sendToUser(userCashout.user_id, {
              type: 'auto_cashout_triggered',
              cashoutMultiplier: cashoutMultiplier,
              cashoutAmount: cashoutAmount,
              betAmount: betAmount,
              roundId: this.crashState.currentRoundId,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.error('Error processing auto-cashouts:', error);
    }
  }

  // Cleanup method to prevent memory leaks
  cleanup() {
    // Clear game loop intervals
    if (this.crashGameLoop) {
      clearInterval(this.crashGameLoop);
      this.crashGameLoop = null;
    }
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Reset auto-cashout check time
    this.lastAutoCashoutCheck = 0;
    
    // Clear all maps and sets to free memory
    this.games.clear();
    this.gameStates.clear();
    this.activeGames.clear();
    this.userLastMessageTime.clear();
    
    // Reset crash state
    this.crashState = {
      phase: 'waiting',
      currentRoundId: null,
      currentMultiplier: 1.00,
      phaseStartTime: Date.now(),
      resultPhaseStartTime: null,
      activePlayersCount: 0,
      totalBetAmount: 0.00,
      currentCrashPoint: 1.00,
      currentRoundNumber: 1,
      gameHash: null,
      serverSeed: null,
      clientSeed: null
    };
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
}

module.exports = GameLoopEngine;