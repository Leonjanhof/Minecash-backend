// Environment Manager - Manage environment variables
// Purpose: Handle environment configuration and secrets

class EnvManager {
  constructor() {
    this.env = process.env;
    this.validateEnvironment();
  }

  // Validate required environment variables
  validateEnvironment() {
    // TODO: Implement environment validation
    // - Check required variables
    // - Validate format
    // - Set defaults if needed
  }

  // Get database connection settings
  getDatabaseConfig() {
    return {
      url: this.env.SUPABASE_URL,
      serviceKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: this.env.SUPABASE_ANON_KEY
    };
  }

  // Get WebSocket server configuration
  getWebSocketConfig() {
    return {
      port: this.env.WS_PORT || 8080,
      host: this.env.WS_HOST || 'localhost'
    };
  }

  // Get API endpoint configuration
  getApiConfig() {
    return {
      port: this.env.API_PORT || 3000,
      host: this.env.API_HOST || 'localhost',
      cors: this.env.CORS_ORIGIN || '*'
    };
  }

  // Get security settings (using Supabase Auth)
  getSecurityConfig() {
    return {
      // No JWT secret needed - using Supabase Auth
      supabaseUrl: this.env.SUPABASE_URL,
      supabaseServiceKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      rateLimitWindow: this.env.RATE_LIMIT_WINDOW || 60000,
      maxRequestsPerWindow: this.env.MAX_REQUESTS_PER_WINDOW || 100
    };
  }

  // Get development/production mode
  getMode() {
    return this.env.NODE_ENV || 'development';
  }

  // Check if in development mode
  isDevelopment() {
    return this.getMode() === 'development';
  }

  // Check if in production mode
  isProduction() {
    return this.getMode() === 'production';
  }
}

module.exports = EnvManager; 