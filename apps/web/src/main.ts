import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import 'bootstrap/dist/css/bootstrap.min.css';
import App from './App.vue';
import './style.css';

registerSW({ immediate: true });
createApp(App).mount('#app');
