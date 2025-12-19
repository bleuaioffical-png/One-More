
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
  syncNow: () => Promise<void>;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

const CLOUD_API_BASE = 'https://jsonblob.com/api/jsonBlob';
const MASTER_DISCOVERY_BLOB = '1344265415712161792'; 

const safeFetch = async (url: string, options: RequestInit = {}, retries = 2): Promise<Response> => {
  if (!navigator.onLine) {
    throw new Error('Device is offline');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

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
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || 'main-branch';
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
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState(Date.now());
  
  const stateRef = useRef({ menuItems, categories, orders, discountMilestones, settings, tenants, activityLog });
  const lastUpdateRef = useRef<number>(0); 
  const cloudIdRef = useRef<string | null>(localStorage.getItem(`cloud_blob_${tenantId}`));
  const isFirstSyncRef = useRef(true);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    stateRef.current = { menuItems, categories, orders, discountMilestones, settings, tenants, activityLog };
  }, [menuItems, categories, orders, discountMilestones, settings, tenants, activityLog]);

  useEffect(() => {
    try {
      broadcastChannelRef.current = new BroadcastChannel(`restaurant_sync_${tenantId}`);
      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data === 'sync_requested') syncWithCloud();
      };
    } catch (e) { /* ignore */ }
    return () => broadcastChannelRef.current?.close();
  }, [tenantId]);

  const syncWithCloud = async (forcePush = false) => {
    if (isSyncing && !forcePush) return;
    setIsSyncing(true);

    try {
      // 1. Discovery Phase - Only run if missing ID or if we're Super Admin
      if (!cloudIdRef.current || isSuperAdmin || forcePush) {
        try {
          const dRes = await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`);
          if (dRes.ok) {
            const discoveryMap = await dRes.json();
            if (discoveryMap[tenantId]) {
              cloudIdRef.current = discoveryMap[tenantId];
              localStorage.setItem(`cloud_blob_${tenantId}`, cloudIdRef.current!);
            }
            if (isSuperAdmin && discoveryMap.tenants_list && !forcePush) {
              setTenants(discoveryMap.tenants_list);
            }
            
            // If we're super admin and pushing, update the master registry
            if (isSuperAdmin && forcePush) {
              await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
                method: 'PUT',
                body: JSON.stringify({ ...discoveryMap, tenants_list: stateRef.current.tenants, [tenantId]: cloudIdRef.current })
              });
            }
          }
        } catch (e) {
          console.warn("Registry unavailable, using cached links");
        }
      }

      // 2. Data Provisioning
      if (!cloudIdRef.current) {
        const res = await safeFetch(CLOUD_API_BASE, {
          method: 'POST',
          body: JSON.stringify({ ...stateRef.current, lastUpdate: Date.now() })
        });
        const location = res.headers.get('Location');
        const newId = location?.split('/').pop();
        if (newId) {
          cloudIdRef.current = newId;
          localStorage.setItem(`cloud_blob_${tenantId}`, newId);
          // Try to register new ID if possible (fire and forget)
          safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`).then(async r => {
             if (r.ok) {
               const map = await r.json();
               safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
                 method: 'PUT',
                 body: JSON.stringify({ ...map, [tenantId]: newId })
               });
             }
          }).catch(() => {});
        }
      }

      // 3. Main Data Sync
      if (cloudIdRef.current) {
        const res = await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`);
        if (res.ok) {
          const remoteData = await res.json();
          const remoteTime = remoteData.lastUpdate || 0;
          const currentOrders = [...stateRef.current.orders];
          let ordersMerged = false;

          (remoteData.orders || []).forEach((ro: Order) => {
            const idx = currentOrders.findIndex(lo => lo.id === ro.id);
            if (idx === -1) {
              currentOrders.push(ro);
              ordersMerged = true;
            } else if (ro.timestamp > currentOrders[idx].timestamp || ro.status !== currentOrders[idx].status) {
              currentOrders[idx] = ro;
              ordersMerged = true;
            }
          });

          const pullingConfig = (remoteTime > lastUpdateRef.current) || isFirstSyncRef.current;
          if (pullingConfig && !forcePush) {
            if (remoteData.menuItems) setMenuItems(remoteData.menuItems);
            if (remoteData.categories) setCategories(remoteData.categories);
            if (remoteData.settings) setSettings(remoteData.settings);
            if (remoteData.discountMilestones) setDiscountMilestones(remoteData.discountMilestones);
            if (remoteData.activityLog) setActivityLog(remoteData.activityLog);
            lastUpdateRef.current = remoteTime;
          }

          if (ordersMerged) {
            setOrders(currentOrders.sort((a, b) => b.timestamp - a.timestamp));
          }

          if (forcePush || (lastUpdateRef.current > remoteTime) || ordersMerged) {
            const stamp = Date.now();
            await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`, {
              method: 'PUT',
              body: JSON.stringify({ ...stateRef.current, orders: currentOrders, lastUpdate: stamp })
            });
            lastUpdateRef.current = stamp;
          }
        }
      }
      
      setSyncError(null);
      setLastSyncTime(Date.now());
      isFirstSyncRef.current = false;
    } catch (err: any) {
      if (!navigator.onLine) {
        setSyncError("Device is offline");
      } else if (forcePush) {
        setSyncError("Sync failed. Check connection.");
      }
      console.warn("Sync error:", err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    let interval: number;
    const startHeartbeat = (ms: number) => {
      if (interval) clearInterval(interval);
      interval = window.setInterval(() => syncWithCloud(), ms);
    };

    const handleState = () => {
      if (document.visibilityState === 'visible') {
        syncWithCloud();
        startHeartbeat(5000); 
      } else {
        startHeartbeat(60000); 
      }
    };

    document.addEventListener('visibilitychange', handleState);
    window.addEventListener('online', () => syncWithCloud());
    handleState(); 

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleState);
      window.removeEventListener('online', () => syncWithCloud());
    };
  }, []);

  useEffect(() => {
    const init = async () => {
      const local = localStorage.getItem(`restaurant_data_${tenantId}`);
      if (local) {
        try {
          const data = JSON.parse(local);
          setMenuItems(data.menuItems || MENU_ITEMS);
          setCategories(data.categories || Object.values(Category));
          setSettings(data.settings || INITIAL_SETTINGS);
          setDiscountMilestones(data.discountMilestones || []);
          setOrders(data.orders || []);
          setActivityLog(data.activityLog || []);
        } catch (e) {
          setMenuItems(MENU_ITEMS);
          setCategories(Object.values(Category));
        }
      } else {
        setMenuItems(MENU_ITEMS);
        setCategories(Object.values(Category));
      }
      setIsInitialized(true);
      setTimeout(() => syncWithCloud(), 500);
    };
    init();
  }, [tenantId]);

  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(`restaurant_data_${tenantId}`, JSON.stringify(stateRef.current));
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
    setTimeout(() => syncWithCloud(true), 100);
  };

  const deleteTenant = (id: string) => {
    setTenants(prev => prev.filter(t => t.id !== id));
    setTimeout(() => syncWithCloud(true), 100);
  };

  const addMenuItem = (item: MenuItem) => {
    setMenuItems(prev => [...prev, item]);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const updateMenuItem = (item: MenuItem) => {
    setMenuItems(prev => prev.map(i => i.id === item.id ? item : i));
    setTimeout(() => syncWithCloud(true), 100);
  };

  const deleteMenuItem = (id: string) => {
    setMenuItems(prev => prev.filter(i => i.id !== id));
    setTimeout(() => syncWithCloud(true), 100);
  };

  const addCategory = (name: string) => {
    if (!categories.includes(name)) {
      setCategories(prev => [...prev, name]);
      setTimeout(() => syncWithCloud(true), 100);
    }
  };

  const removeCategory = (name: string) => {
    setCategories(prev => prev.filter(c => c !== name));
    setMenuItems(prev => prev.filter(i => i.category !== name));
    setTimeout(() => syncWithCloud(true), 100);
  };

  const renameCategory = (oldName: string, newName: string) => {
    setCategories(prev => prev.map(c => c === oldName ? newName : c));
    setMenuItems(prev => prev.map(i => i.category === oldName ? { ...i, category: newName } : i));
    setTimeout(() => syncWithCloud(true), 100);
  };

  const updateDiscountMilestones = (milestones: DiscountMilestone[]) => {
    setDiscountMilestones(milestones);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const updateSettings = (newSettings: RestaurantSettings) => {
    setSettings(newSettings);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const placeOrder = (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => {
    const newOrder: Order = { ...order, id: Math.random().toString(36).substr(2, 6).toUpperCase(), status: 'PENDING', timestamp: Date.now() };
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

  const clearHistory = () => { setActivityLog([]); setTimeout(() => syncWithCloud(true), 100); };
  const importBusinessData = (data: string) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.menuItems) setMenuItems(parsed.menuItems);
      if (parsed.categories) setCategories(parsed.categories);
      if (parsed.settings) setSettings(parsed.settings);
      setTimeout(() => syncWithCloud(true), 100);
      return true;
    } catch (e) { return false; }
  };
  const exportBusinessData = () => JSON.stringify(stateRef.current);

  const value = {
    tenantId, menuItems, categories, orders, lastPlacedOrder, discountMilestones, settings, activityLog,
    isAdmin, isSuperAdmin, tenants, isSyncing, syncError, lastSyncTime,
    login, logout, addTenant, deleteTenant, addMenuItem, updateMenuItem, deleteMenuItem,
    addCategory, removeCategory, renameCategory, updateDiscountMilestones, updateSettings,
    placeOrder, updateOrderStatus, toggleOrderTakeaway, clearHistory,
    importBusinessData, exportBusinessData, syncNow: () => syncWithCloud(true)
  };

  return <RestaurantContext.Provider value={value}>{children}</RestaurantContext.Provider>;
};

export const useRestaurant = () => {
  const context = useContext(RestaurantContext);
  if (context === undefined) throw new Error('useRestaurant must be used within a RestaurantProvider');
  return context;
};
