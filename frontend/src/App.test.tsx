import { render, screen } from '@testing-library/react'

import App from './App.tsx'

test('the placeholder route renders', () => {
  render(<App />)

  expect(screen.getByRole('heading', { name: 'Bean Counter' })).not.toBeNull()
})
