import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import base from './base.js'

export default [
  ...base,
  {
    name: 'autoservices/react',
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // SECURITY.md §7: XSS. User content is never rendered as HTML.
      'react/no-danger': 'off', // plugin not loaded; covered by the syntax rule below
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'dangerouslySetInnerHTML is banned in application code (SECURITY.md §7). React escapes by default.',
        },
        {
          selector:
            "JSXAttribute[name.name='target'][value.value='_blank']:not(:has(~ JSXAttribute[name.name='rel']))",
          message: 'target="_blank" needs rel="noopener noreferrer".',
        },
      ],
    },
  },
]
