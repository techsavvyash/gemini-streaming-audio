module.exports = {
  apps: [
    {
      name: 'gemini-audio-app',
      script: 'server.js',
      cwd: './backend',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production',
        PORT: 3011,
        WS_PORT: 8888
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G'
    }
  ]
};