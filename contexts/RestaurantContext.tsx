
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { MenuItem, Order, OrderStatus, Category, DiscountMilestone, RestaurantSettings, ActivityEntry, TenantAccount } from '../types';
import { MENU_ITEMS, INITIAL_SETTINGS } from '../constants';

interface RestaurantContextType {
  tenantId: string;
  menuItems: MenuItem[];
  categories: string[];
  orders: Order[];
  lastPlacedOrder: Order | null;
  discountMilestones: DiscountMilestone[];
  settings: RestaurantSettings;
  activityLog: ActivityEntry[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  tenants: TenantAccount[];
  isSyncing: boolean;
  syncError: string | null;
  lastSyncTime: number;
  isLive: boolean;
  login: (password: string) => 'ADMIN' | 'SUPER' | 'NONE';
  logout: () => void;
  addTenant: (tenant: Omit<TenantAccount, 'createdAt' | 'status'>) => void;
  deleteTenant: (id: string) => void;
  addMenuItem: (item: MenuItem) => void;
  updateMenuItem: (item: MenuItem) => void;
  deleteMenuItem: (id: string) => void;
  addCategory: (name: string) => void;
  removeCategory: (name: string) => void;
  renameCategory: (oldName: string, newName: string) => void;
  updateDiscountMilestones: (milestones: DiscountMilestone[]) => void;
  updateSettings: (newSettings: RestaurantSettings) => void;
  placeOrder: (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  toggleOrderTakeaway: (orderId: string) => void;
  clearHistory: () => void;
  importBusinessData: (data: string) => boolean;
  exportBusinessData: () => string;
  syncNow: (forcePush?: boolean) => Promise<void>;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

const CLOUD_API_BASE = 'https://jsonblob.com/api/jsonBlob';
const MASTER_DISCOVERY_BLOB = '1344265415712161792'; 
const SSE_RELAY_BASE = 'https://ntfy.sh';

const safeFetch = async (url: string, options: RequestInit = {}, retries = 2): Promise<Response> => {
  if (!navigator.onLine) throw new Error('Network offline');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...options.headers,
      }
    });
    clearTimeout(timeoutId);
    if (res.status === 429 && retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return safeFetch(url, options, retries - 1);
    }
    return res;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (retries > 0 && err.name !== 'AbortError') {
      await new Promise(r => setTimeout(r, 1500));
      return safeFetch(url, options, retries - 1);
    }
    throw err;
  }
};

export const RestaurantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenantId] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('id') || 'main-branch';
    } catch (e) {
      return 'main-branch';
    }
  });

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastPlacedOrder, setLastPlacedOrder] = useState<Order | null>(null);
  const [settings, setSettings] = useState<RestaurantSettings>(INITIAL_SETTINGS);
  const [discountMilestones, setDiscountMilestones] = useState<DiscountMilestone[]>([]);
  const [tenants, setTenants] = useState<TenantAccount[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState(Date.now());
  
  const stateRef = useRef({ menuItems, categories, orders, discountMilestones, settings, tenants, activityLog });
  const lastUpdateRef = useRef<number>(0); 
  const cloudIdRef = useRef<string | null>(null);
  const isFirstSyncRef = useRef(true);
  
  const isProcessingSync = useRef(false);
  const syncQueue = useRef<boolean>(false);

  // Local Tab Sync Channel
  const localChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    stateRef.current = { menuItems, categories, orders, discountMilestones, settings, tenants, activityLog };
  }, [menuItems, categories, orders, discountMilestones, settings, tenants, activityLog]);

  const broadcastPulse = async () => {
    const topic = `sync-live-v2-${tenantId}`;
    try {
      await fetch(`${SSE_RELAY_BASE}/${topic}`, {
        method: 'POST',
        body: JSON.stringify({ t: Date.now(), origin: 'web', action: 'WAKEUP' }),
        headers: { 'Title': 'Restaurant Sync', 'Priority': '5' },
        keepalive: true
      });
      localChannel.current?.postMessage({ type: 'SYNC_WAKEUP', time: Date.now() });
    } catch (e) {
      console.warn("Real-time pulse failed", e);
    }
  };

  const syncWithCloud = async (forcePush = false) => {
    if (isProcessingSync.current) {
      syncQueue.current = true;
      return;
    }

    isProcessingSync.current = true;
    setIsSyncing(true);

    try {
      if (!cloudIdRef.current) {
         try { cloudIdRef.current = localStorage.getItem(`cloud_blob_${tenantId}`); } catch(e) {}
      }

      if (!cloudIdRef.current || isSuperAdmin || forcePush) {
        try {
          const dRes = await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`);
          if (dRes.ok) {
            const map = await dRes.json();
            if (map[tenantId]) {
              cloudIdRef.current = map[tenantId];
              try { localStorage.setItem(`cloud_blob_${tenantId}`, cloudIdRef.current!); } catch(e) {}
            }
            if (isSuperAdmin && map.tenants_list) setTenants(map.tenants_list);
            
            if (isSuperAdmin && forcePush) {
              await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
                method: 'PUT',
                body: JSON.stringify({ ...map, tenants_list: stateRef.current.tenants, [tenantId]: cloudIdRef.current })
              });
            }
          }
        } catch (e) {}
      }

      if (!cloudIdRef.current) {
        const res = await safeFetch(CLOUD_API_BASE, {
          method: 'POST',
          body: JSON.stringify({ ...stateRef.current, lastUpdate: Date.now() })
        });
        const newId = res.headers.get('Location')?.split('/').pop();
        if (newId) {
          cloudIdRef.current = newId;
          try { localStorage.setItem(`cloud_blob_${tenantId}`, newId); } catch(e) {}
          const dRes = await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`);
          if (dRes.ok) {
            const map = await dRes.json();
            await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
              method: 'PUT',
              body: JSON.stringify({ ...map, [tenantId]: newId })
            });
          }
        }
      }

      if (cloudIdRef.current) {
        const res = await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`);
        if (res.ok) {
          const remote = await res.json();
          const remoteTime = remote.lastUpdate || 0;
          
          const localOrders = [...stateRef.current.orders];
          const remoteOrders = remote.orders || [];
          let needsRemotePush = false;
          let needsLocalUpdate = false;

          const mergedOrders = [...localOrders];
          remoteOrders.forEach((ro: Order) => {
            const localIdx = mergedOrders.findIndex(lo => lo.id === ro.id);
            if (localIdx === -1) {
              mergedOrders.push(ro);
              needsLocalUpdate = true;
            } else if (ro.timestamp > mergedOrders[localIdx].timestamp) {
              mergedOrders[localIdx] = ro;
              needsLocalUpdate = true;
            } else if (ro.timestamp < mergedOrders[localIdx].timestamp) {
              needsRemotePush = true;
            }
          });

          const finalOrders = mergedOrders.sort((a, b) => b.timestamp - a.timestamp);
          const remoteConfigIsNewer = (remoteTime > lastUpdateRef.current) || isFirstSyncRef.current;
          
          if (remoteConfigIsNewer && !forcePush) {
            if (remote.menuItems) setMenuItems(remote.menuItems);
            if (remote.categories) setCategories(remote.categories);
            if (remote.settings) setSettings(remote.settings);
            if (remote.discountMilestones) setDiscountMilestones(remote.discountMilestones);
            lastUpdateRef.current = remoteTime;
          }

          if (needsLocalUpdate) setOrders(finalOrders);

          if (forcePush || (lastUpdateRef.current > remoteTime) || needsRemotePush || needsLocalUpdate) {
            const syncStamp = Date.now();
            await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`, {
              method: 'PUT',
              body: JSON.stringify({ ...stateRef.current, orders: finalOrders, lastUpdate: syncStamp })
            });
            lastUpdateRef.current = syncStamp;
            if (forcePush || needsRemotePush || needsLocalUpdate) await broadcastPulse();
          }
        }
      }
      
      setSyncError(null);
      setLastSyncTime(Date.now());
      isFirstSyncRef.current = false;
    } catch (err: any) {
      console.warn("Sync error:", err.message);
      setSyncError(err.message);
    } finally {
      isProcessingSync.current = false;
      setIsSyncing(false);
      if (syncQueue.current) {
        syncQueue.current = false;
        syncWithCloud(true);
      }
    }
  };

  useEffect(() => {
    try {
      localChannel.current = new BroadcastChannel(`restaurant_sync_v2_${tenantId}`);
      localChannel.current.onmessage = (event) => {
        if (event.data.type === 'SYNC_WAKEUP') syncWithCloud();
      };
    } catch (e) {}

    let eventSource: EventSource | null = null;
    const connectSSE = () => {
      try {
        if (eventSource) eventSource.close();
        const topic = `sync-live-v2-${tenantId}`;
        eventSource = new EventSource(`${SSE_RELAY_BASE}/${topic}/sse`);
        eventSource.onopen = () => setIsLive(true);
        eventSource.onmessage = () => syncWithCloud();
        eventSource.onerror = () => {
          setIsLive(false);
          setTimeout(connectSSE, 10000);
        };
      } catch (e) {
        setIsLive(false);
      }
    };

    connectSSE();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') syncWithCloud();
    }, 20000);

    return () => {
      eventSource?.close();
      try { localChannel.current?.close(); } catch(e) {}
      clearInterval(interval);
    };
  }, [tenantId]);

  useEffect(() => {
    const init = async () => {
      try {
        const local = localStorage.getItem(`restaurant_data_v2_${tenantId}`);
        if (local) {
          const data = JSON.parse(local);
          setMenuItems(data.menuItems || MENU_ITEMS);
          setCategories(data.categories || Object.values(Category));
          setSettings(data.settings || INITIAL_SETTINGS);
          setDiscountMilestones(data.discountMilestones || []);
          setOrders(data.orders || []);
          setActivityLog(data.activityLog || []);
        } else {
          setMenuItems(MENU_ITEMS);
          setCategories(Object.values(Category));
        }
      } catch (e) {
        setMenuItems(MENU_ITEMS);
        setCategories(Object.values(Category));
      }
      setIsInitialized(true);
      setTimeout(() => syncWithCloud(), 200);
    };
    init();
  }, [tenantId]);

  useEffect(() => {
    if (isInitialized) {
      try { localStorage.setItem(`restaurant_data_v2_${tenantId}`, JSON.stringify(stateRef.current)); } catch(e) {}
    }
  }, [isInitialized, menuItems, categories, orders, discountMilestones, settings, activityLog, tenantId]);

  const login = (password: string) => {
    if (password === 'master99') { setIsSuperAdmin(true); setIsAdmin(true); return 'SUPER'; }
    if (password === 'admin123') { setIsAdmin(true); return 'ADMIN'; }
    return 'NONE';
  };

  const logout = () => { setIsAdmin(false); setIsSuperAdmin(false); };

  const addTenant = (tenant: Omit<TenantAccount, 'createdAt' | 'status'>) => {
    const newT: TenantAccount = { ...tenant, createdAt: Date.now(), status: 'ACTIVE' };
    setTenants(prev => [...prev, newT]);
    syncWithCloud(true);
  };

  const deleteTenant = (id: string) => {
    setTenants(prev => prev.filter(t => t.id !== id));
    syncWithCloud(true);
  };

  const addMenuItem = (item: MenuItem) => {
    setMenuItems(prev => [...prev, item]);
    syncWithCloud(true);
  };

  const updateMenuItem = (item: MenuItem) => {
    setMenuItems(prev => prev.map(i => i.id === item.id ? item : i));
    syncWithCloud(true);
  };

  const deleteMenuItem = (id: string) => {
    setMenuItems(prev => prev.filter(i => i.id !== id));
    syncWithCloud(true);
  };

  const addCategory = (name: string) => {
    if (!categories.includes(name)) {
      setCategories(prev => [...prev, name]);
      syncWithCloud(true);
    }
  };

  const removeCategory = (name: string) => {
    setCategories(prev => prev.filter(c => c !== name));
    setMenuItems(prev => prev.filter(i => i.category !== name));
    syncWithCloud(true);
  };

  const renameCategory = (oldName: string, newName: string) => {
    setCategories(prev => prev.map(c => c === oldName ? newName : c));
    setMenuItems(prev => prev.map(i => i.category === oldName ? { ...i, category: newName } : i));
    syncWithCloud(true);
  };

  const updateDiscountMilestones = (milestones: DiscountMilestone[]) => {
    setDiscountMilestones(milestones);
    syncWithCloud(true);
  };

  const updateSettings = (newSettings: RestaurantSettings) => {
    setSettings(newSettings);
    syncWithCloud(true);
  };

  const placeOrder = (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => {
    const newOrder: Order = { 
      ...order, 
      id: Math.random().toString(36).substr(2, 6).toUpperCase(), 
      status: 'PENDING', 
      timestamp: Date.now() 
    };
    setOrders(prev => [newOrder, ...prev]);
    setLastPlacedOrder(newOrder);
    syncWithCloud(true);
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status, timestamp: Date.now() } : o));
    syncWithCloud(true);
  };

  const toggleOrderTakeaway = (orderId: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, isTakeaway: !o.isTakeaway, timestamp: Date.now() } : o));
    syncWithCloud(true);
  };

  const clearHistory = () => { setActivityLog([]); syncWithCloud(true); };
  const importBusinessData = (data: string) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.menuItems) setMenuItems(parsed.menuItems);
      if (parsed.categories) setCategories(parsed.categories);
      if (parsed.settings) setSettings(parsed.settings);
      syncWithCloud(true);
      return true;
    } catch (e) { return false; }
  };
  const exportBusinessData = () => JSON.stringify(stateRef.current);

  const value = {
    tenantId, menuItems, categories, orders, lastPlacedOrder, discountMilestones, settings, activityLog,
    isAdmin, isSuperAdmin, tenants, isSyncing, syncError, lastSyncTime, isLive,
    login, logout, addTenant, deleteTenant, addMenuItem, updateMenuItem, deleteMenuItem,
    addCategory, removeCategory, renameCategory, updateDiscountMilestones, updateSettings,
    placeOrder, updateOrderStatus, toggleOrderTakeaway, clearHistory,
    importBusinessData, exportBusinessData, syncNow: (force?: boolean) => syncWithCloud(force)
  };

  return <RestaurantContext.Provider value={value}>{children}</RestaurantContext.Provider>;
};

export const useRestaurant = () => {
  const context = useContext(RestaurantContext);
  if (context === undefined) throw new Error('useRestaurant must be used within a RestaurantProvider');
  return context;
};
