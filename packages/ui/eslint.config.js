import react from '@autoservices/eslint-config/react'

export default [
  ...react,
  {
    // react-refresh is about dev-server HMR boundaries in an APP. This is a component
    // library consumed as source; exporting a style helper next to its component is
    // correct here, not a defect.
    name: 'autoservices/ui-library',
    rules: { 'react-refresh/only-export-components': 'off' },
  },
]
