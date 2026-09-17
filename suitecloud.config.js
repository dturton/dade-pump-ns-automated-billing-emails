const { execSync } = require('child_process');

module.exports = {
  defaultProjectFolder: 'src',
  commands: {
    'project:deploy': {
      beforeExecuting: async (args) => {
        execSync('npm run build', { stdio: 'inherit' });
        return args;
      },
    },
  },
};
