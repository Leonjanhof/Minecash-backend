const { createClient } = require('@supabase/supabase-js');

class LoggingService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.logLevels = {
      INFO: 'info',
      WARNING: 'warning', 
      ERROR: 'error',
      SUCCESS: 'success'
    };
  }

  // Send log to admin panel via database
  async sendToAdminPanel(message, level = 'info', details = null) {
    try {
      const { error } = await this.supabase
        .from('admin_logs')
        .insert({
          message: message,
          level: level,
          details: details,
          timestamp: new Date().toISOString(),
          source: 'backend'
        });

      if (error) {
        console.error('failed to send log to admin panel:', error);
      }
    } catch (error) {
      console.error('error sending log to admin panel:', error);
    }
  }

  // Log info level
  async info(message, details = null) {
    console.log(`[INFO] ${message}`);
    await this.sendToAdminPanel(message, this.logLevels.INFO, details);
  }

  // Log warning level
  async warning(message, details = null) {
    console.warn(`[WARNING] ${message}`);
    await this.sendToAdminPanel(message, this.logLevels.WARNING, details);
  }

  // Log error level
  async error(message, details = null) {
    console.error(`[ERROR] ${message}`);
    await this.sendToAdminPanel(message, this.logLevels.ERROR, details);
  }

  // Log success level
  async success(message, details = null) {
    console.log(`[SUCCESS] ${message}`);
    await this.sendToAdminPanel(message, this.logLevels.SUCCESS, details);
  }

  // Log game events
  async gameEvent(gameType, event, details = null) {
    const message = `${gameType} game: ${event}`;
    console.log(`[GAME] ${message}`);
    await this.sendToAdminPanel(message, this.logLevels.INFO, details);
  }

  // Log user events
  async userEvent(userId, event, details = null) {
    const message = `User ${userId}: ${event}`;
    console.log(`[USER] ${message}`);
    await this.sendToAdminPanel(message, this.logLevels.INFO, details);
  }

  // Log system events
  async systemEvent(event, details = null) {
    const message = `System: ${event}`;
    console.log(`[SYSTEM] ${message}`);
    await this.sendToAdminPanel(message, this.logLevels.INFO, details);
  }
}

module.exports = LoggingService; 