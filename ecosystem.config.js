module.exports = {
  apps: [
    {
      name: 'gemini-audio-app',
      script: 'server.js',
      cwd: './backend',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        WS_PORT: 3002
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G'
    }
  ]
};