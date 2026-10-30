import './src/sentry';
import { registerRootComponent } from 'expo';
import { wrapRoot } from './src/sentry';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(wrapRoot(App as any));
