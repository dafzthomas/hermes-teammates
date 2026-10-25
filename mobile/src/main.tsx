import { createRoot } from 'react-dom/client';
import { MobileApp } from './App';
import { applyPlatformStyle } from '../../src/platform';
import './style.css';
applyPlatformStyle();
createRoot(document.getElementById('root')!).render(<MobileApp />);
