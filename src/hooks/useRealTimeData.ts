import { useEffect, useState } from 'react';

const useRealTimeData = (url: string) => {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let socket: WebSocket;

    const connectWebSocket = () => {
      socket = new WebSocket(url);

      socket.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data);
          setData((prev) => [...prev, parsedData]);
        } catch (parseError) {
          setError('Failed to parse WebSocket data');
        }
      };

      socket.onerror = () => {
        setError('WebSocket connection error');
      };

      socket.onclose = () => {
        console.log('WebSocket closed, reconnecting...');
        setTimeout(connectWebSocket, 5000);
      };
    };

    connectWebSocket();

    return () => {
      socket.close();
    };
  }, [url]);

  return { data, error };
};

export default useRealTimeData;
