import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyPlatformStyle } from './platform';
import './style.css';

applyPlatformStyle();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
