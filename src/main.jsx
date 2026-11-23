import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-stone/theme.css';
import './fonts/pretendard.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
