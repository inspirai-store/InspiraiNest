import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import {App} from '../workbench/App';
import {createBrowserBridge,browserSettings} from './bridge.mjs';
import '../../packages/design-tokens/tokens.css';
import '../../packages/design-tokens/global.css';
Object.assign(window,{library:createBrowserBridge(),desktopSettings:browserSettings()});
createRoot(document.getElementById('root')!).render(<StrictMode><HashRouter><App/></HashRouter></StrictMode>);
