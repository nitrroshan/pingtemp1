import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './styles/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      theme="dark"
      richColors
      toastOptions={{
        style: { background: 'hsl(240 4% 10%)', border: '1px solid hsl(240 4% 16%)', color: 'hsl(240 5% 98%)' },
      }}
    />
  </React.StrictMode>
);