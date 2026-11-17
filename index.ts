import { wrapRoot } from './src/sentry';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(wrapRoot(App as any));
