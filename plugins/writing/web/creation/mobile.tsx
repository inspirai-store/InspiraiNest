import {createRoot} from 'react-dom/client';
import {CreationWorkbench} from './CreationWorkbench';
import '../../../../packages/design-tokens/tokens.css';
import '../../../../packages/design-tokens/global.css';
createRoot(document.getElementById('creation-root')!).render(<CreationWorkbench/>);
