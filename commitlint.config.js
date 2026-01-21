// Allowed commit types for this project
const ALLOWED_TYPES = [
  'Add',      // New feature or functionality
  'Fix',      // Bug fix
  'Refactor', // Code refactoring without behavior change
  'Docs',     // Documentation only
  'Update',   // Update existing feature
  'Feature',  // Major new feature
  'Optimize', // Performance optimization
  'Cleanup',  // Code cleanup, remove unused code
  'Config',   // Configuration changes
  'Merge',    // Merge commits
  'Test',     // Adding or updating tests
  'Style',    // Code style/formatting changes
];

export default {
  parserPreset: {
    parserOpts: {
      headerPattern: /^\[(\w+)\] (.+)$/,
      headerCorrespondence: ['type', 'subject'],
    },
  },
  plugins: [
    {
      rules: {
        'type-enum-custom': (parsed) => {
          const { type } = parsed;
          if (!type) {
            return [false, `Commit type is required. Use: [${ALLOWED_TYPES.join('|')}]`];
          }
          if (!ALLOWED_TYPES.includes(type)) {
            return [
              false,
              `Invalid type "${type}". Allowed types: [${ALLOWED_TYPES.join('|')}]\n` +
              `Example: [Add] Implement new feature`
            ];
          }
          return [true];
        },
      },
    },
  ],
  rules: {
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
    'type-enum-custom': [2, 'always'],
  },
};
