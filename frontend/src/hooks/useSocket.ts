import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Socket, io } from 'socket.io-client';

interface SocketMessage {
  id: string;
  type: string;
  payload: any;
  timestamp: Date;
  from?: string;
  to?: string;
}

interface SocketMetrics {
  messagesReceived: number;
  messagesSent: number;
  reconnectionAttempts: number;
  lastHeartbeat: Date | null;
  latency: number;
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  metrics: SocketMetrics;
  messageHistory: SocketMessage[];
  sendMessage: (type: string, payload: any, targetAgent?: string) => void;
  subscribe: (eventType: string, callback: (data: any) => void) => () => void;
  reconnect: () => void;
  disconnect: () => void;
  clearHistory: () => void;
}

const initialMetrics: SocketMetrics = {
  messagesReceived: 0,
  messagesSent: 0,
  reconnectionAttempts: 0,
  lastHeartbeat: null,
  latency: 0
};

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  connectionStatus: 'disconnected',
  metrics: initialMetrics,
  messageHistory: [],
  sendMessage: () => {},
  subscribe: () => () => {},
  reconnect: () => {},
  disconnect: () => {},
  clearHistory: () => {}
});

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

// Enhanced Socket Provider with advanced features
export const SocketProvider: React.FC<{ children: React.ReactNode; url?: string }> = ({ 
  children, 
  url = `ws://localhost:3001` 
}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'>('disconnected');
  const [metrics, setMetrics] = useState<SocketMetrics>(initialMetrics);
  const [messageHistory, setMessageHistory] = useState<SocketMessage[]>([]);
  const eventListenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isConnected = connectionStatus === 'connected';

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(url, {
      transports: ['websocket', 'polling'],
      timeout: 5000,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    setSocket(newSocket);
    setConnectionStatus('connecting');

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('🔗 Socket connected to Orion orchestrator');
      setConnectionStatus('connected');
      setMetrics(prev => ({ ...prev, reconnectionAttempts: 0 }));
      startHeartbeat(newSocket);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      setConnectionStatus('disconnected');
      stopHeartbeat();
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
      setConnectionStatus('connected');
      setMetrics(prev => ({ ...prev, reconnectionAttempts: attemptNumber }));
    });

    newSocket.on('reconnect_attempt', () => {
      setConnectionStatus('reconnecting');
    });

    newSocket.on('connect_error', (error) => {
      console.error('🚫 Socket connection error:', error);
      setConnectionStatus('error');
    });

    // Universal message handler
    newSocket.onAny((eventType, data) => {
      const message: SocketMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: eventType,
        payload: data,
        timestamp: new Date()
      };

      setMessageHistory(prev => [...prev.slice(-99), message]); // Keep last 100 messages
      setMetrics(prev => ({ ...prev, messagesReceived: prev.messagesReceived + 1 }));

      // Trigger registered event listeners
      const listeners = eventListenersRef.current.get(eventType);
      if (listeners) {
        listeners.forEach(callback => callback(data));
      }
    });

    return () => {
      stopHeartbeat();
      newSocket.disconnect();
    };
  }, [url]);

  const startHeartbeat = (socketInstance: Socket) => {
    heartbeatIntervalRef.current = setInterval(() => {
      const start = Date.now();
      socketInstance.emit('ping', { timestamp: start });
      
      socketInstance.once('pong', (data) => {
        const latency = Date.now() - start;
        setMetrics(prev => ({
          ...prev,
          lastHeartbeat: new Date(),
          latency
        }));
      });
    }, 30000); // Every 30 seconds
  };

  const stopHeartbeat = () => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  };

  const sendMessage = useCallback((type: string, payload: any, targetAgent?: string) => {
    if (!socket || !isConnected) {
      console.warn('Cannot send message: socket not connected');
      return;
    }

    const message = {
      type,
      payload,
      targetAgent,
      timestamp: new Date(),
      from: 'frontend'
    };

    socket.emit(type, message);
    setMetrics(prev => ({ ...prev, messagesSent: prev.messagesSent + 1 }));

    // Add to history as sent message
    const historyMessage: SocketMessage = {
      id: `sent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      payload: message,
      timestamp: new Date(),
      from: 'frontend',
      to: targetAgent
    };
    setMessageHistory(prev => [...prev.slice(-99), historyMessage]);
  }, [socket, isConnected]);

  const subscribe = useCallback((eventType: string, callback: (data: any) => void) => {
    if (!eventListenersRef.current.has(eventType)) {
      eventListenersRef.current.set(eventType, new Set());
    }
    eventListenersRef.current.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = eventListenersRef.current.get(eventType);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          eventListenersRef.current.delete(eventType);
        }
      }
    };
  }, []);

  const reconnect = useCallback(() => {
    socket?.disconnect();
    socket?.connect();
  }, [socket]);

  const disconnect = useCallback(() => {
    socket?.disconnect();
  }, [socket]);

  const clearHistory = useCallback(() => {
    setMessageHistory([]);
  }, []);

  const contextValue: SocketContextType = {
    socket,
    isConnected,
    connectionStatus,
    metrics,
    messageHistory,
    sendMessage,
    subscribe,
    reconnect,
    disconnect,
    clearHistory
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};

// Specialized hook for agent communication
export const useAgentCommunication = () => {
  const { sendMessage, subscribe } = useSocket();

  const sendToAgent = useCallback((agentId: string, action: string, data: any) => {
    sendMessage('agent:message', {
      action,
      data,
      requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }, agentId);
  }, [sendMessage]);

  const subscribeToAgent = useCallback((agentId: string, callback: (data: any) => void) => {
    return subscribe(`agent:response:${agentId}`, callback);
  }, [subscribe]);

  const subscribeToAllAgents = useCallback((callback: (data: any) => void) => {
    return subscribe('agent:broadcast', callback);
  }, [subscribe]);

  return {
    sendToAgent,
    subscribeToAgent,
    subscribeToAllAgents
  };
};