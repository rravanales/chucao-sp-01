// eslint.config.mjs
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

// NÓTESE: export por nombre para evitar la warning de import/no-anonymous-default-export
const config = [
  // 1) Ignorar artefactos y dependencias
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'build/**'] },

  // 2) Tu configuración legacy convertida a flat (Next + Tailwind + Prettier)
  ...compat.config({
    extends: [
      'next/core-web-vitals',
      'plugin:tailwindcss/recommended',
      'prettier',
    ],
    plugins: ['tailwindcss'], // (legacy: compat lo resuelve)
    settings: {
      tailwindcss: { callees: ['cn', 'cva'], config: 'tailwind.config.js' },
    },
    rules: {
      '@next/next/no-img-element': 'off',
      'jsx-a11y/alt-text': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'tailwindcss/enforces-negative-arbitrary-values': 'off',
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
      'react/no-unescaped-entities': 'off',
    },
  }),

  // 3) Registrar el plugin de TS para archivos TS/TSX
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    // En flat config los plugins se declaran como objeto:
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    // Opcional: ajusta esta regla si lo deseas
    // '@typescript-eslint/no-explicit-any': 'off',
  },
];

export default config;
