
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

// Utility for robust API calls with retry logic
const safeFetch = async (url: string, options: RequestInit = {}, retries = 3, timeout = 10000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const headers = { 
    'Content-Type': 'application/json', 
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  };

  try {
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: controller.signal });
    clearTimeout(id);
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return safeFetch(url, options, retries - 1, timeout);
    }
    return res;
  } catch (err: any) {
    clearTimeout(id);
    if (retries > 0 && (err.name === 'AbortError' || err.message.includes('fetch'))) {
      await new Promise(r => setTimeout(r, 1000));
      return safeFetch(url, options, retries - 1, timeout);
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
        if (event.data === 'sync_now') {
          syncWithCloud();
        }
      };
    } catch (e) { console.warn("BroadcastChannel not supported"); }
    return () => { broadcastChannelRef.current?.close(); };
  }, [tenantId]);

  const notifyOtherTabs = () => {
    broadcastChannelRef.current?.postMessage('sync_now');
  };

  const syncWithCloud = async (forcePush = false) => {
    if (isSyncing) return;
    setIsSyncing(true);

    try {
      let discoveryMap: Record<string, any> = {};
      let discoverySuccess = false;
      try {
        const dRes = await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`);
        if (dRes.ok) {
          discoveryMap = await dRes.json();
          discoverySuccess = true;
          if (discoveryMap[tenantId]) {
            cloudIdRef.current = discoveryMap[tenantId];
            localStorage.setItem(`cloud_blob_${tenantId}`, cloudIdRef.current!);
          }
        }
      } catch (e) { console.warn("Registry sync failed, using local cache"); }

      if (isSuperAdmin && discoverySuccess) {
        if (forcePush) {
          await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
            method: 'PUT',
            body: JSON.stringify({ ...discoveryMap, tenants_list: stateRef.current.tenants })
          });
        } else if (discoveryMap.tenants_list) {
          setTenants(discoveryMap.tenants_list);
        }
      }

      const localState = stateRef.current;

      if (!cloudIdRef.current) {
        if (discoverySuccess && !discoveryMap[tenantId]) {
          const res = await safeFetch(CLOUD_API_BASE, {
            method: 'POST',
            body: JSON.stringify({ ...localState, lastUpdate: Date.now() })
          });
          const location = res.headers.get('Location');
          const newId = location?.split('/').pop();
          if (newId) {
            cloudIdRef.current = newId;
            localStorage.setItem(`cloud_blob_${tenantId}`, newId);
            await safeFetch(`${CLOUD_API_BASE}/${MASTER_DISCOVERY_BLOB}`, {
              method: 'PUT',
              body: JSON.stringify({ ...discoveryMap, [tenantId]: newId })
            });
          }
        }
      } else {
        const res = await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`);
        if (!res.ok) {
          if (res.status === 404) { cloudIdRef.current = null; return; }
          throw new Error('Connection jitter');
        }
        
        const remoteData = await res.json();
        const remoteTime = remoteData.lastUpdate || 0;

        const remoteOrders = remoteData.orders || [];
        const currentOrders = [...localState.orders];
        let ordersWereMerged = false;

        remoteOrders.forEach((ro: Order) => {
          const idx = currentOrders.findIndex(lo => lo.id === ro.id);
          if (idx === -1) {
            currentOrders.push(ro);
            ordersWereMerged = true;
          } else if (ro.timestamp > currentOrders[idx].timestamp || ro.status !== currentOrders[idx].status) {
            currentOrders[idx] = ro;
            ordersWereMerged = true;
          }
        });

        const shouldAdoptRemote = (remoteTime > lastUpdateRef.current) || isFirstSyncRef.current;
        
        if (shouldAdoptRemote && !forcePush) {
          if (remoteData.menuItems) setMenuItems(remoteData.menuItems);
          if (remoteData.categories) setCategories(remoteData.categories);
          if (remoteData.settings) setSettings(remoteData.settings);
          if (remoteData.discountMilestones) setDiscountMilestones(remoteData.discountMilestones);
          if (remoteData.activityLog) setActivityLog(remoteData.activityLog);
          lastUpdateRef.current = remoteTime;
        }

        if (ordersWereMerged) {
          setOrders(currentOrders.sort((a, b) => b.timestamp - a.timestamp));
        }

        if (forcePush || ordersWereMerged || (lastUpdateRef.current > remoteTime)) {
          const pushTime = forcePush ? Date.now() : Math.max(lastUpdateRef.current, remoteTime);
          const dataToPush = {
            ...stateRef.current,
            orders: ordersWereMerged ? currentOrders : stateRef.current.orders,
            lastUpdate: pushTime
          };
          
          await safeFetch(`${CLOUD_API_BASE}/${cloudIdRef.current}`, {
            method: 'PUT',
            body: JSON.stringify(dataToPush)
          });
          lastUpdateRef.current = pushTime;
        }
      }
      setSyncError(null);
      setLastSyncTime(Date.now());
      isFirstSyncRef.current = false;
    } catch (err: any) {
      setSyncError(err.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const local = localStorage.getItem(`restaurant_data_${tenantId}`);
      if (local) {
        try {
          const data = JSON.parse(local);
          if (data.menuItems) setMenuItems(data.menuItems);
          if (data.categories) setCategories(data.categories);
          if (data.settings) setSettings(data.settings);
          if (data.discountMilestones) setDiscountMilestones(data.discountMilestones);
          if (data.orders) setOrders(data.orders);
          if (data.activityLog) setActivityLog(data.activityLog);
        } catch (e) {
          setMenuItems(MENU_ITEMS);
          setCategories(Object.values(Category));
        }
      } else {
        setMenuItems(MENU_ITEMS);
        setCategories(Object.values(Category));
      }
      setIsInitialized(true);
      await syncWithCloud();
    };
    init();
  }, [tenantId]);

  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(`restaurant_data_${tenantId}`, JSON.stringify(stateRef.current));
    }
  }, [isInitialized, menuItems, categories, orders, discountMilestones, settings, activityLog, tenantId]);

  useEffect(() => {
    const interval = setInterval(() => syncWithCloud(), 30000);
    return () => clearInterval(interval);
  }, []);

  const addActivity = (type: ActivityEntry['type'], entity: ActivityEntry['entity'], description: string) => {
    const entry: ActivityEntry = { id: Math.random().toString(36).substr(2, 9), type, entity, description, timestamp: Date.now() };
    setActivityLog(prev => [entry, ...prev].slice(0, 100));
  };

  const login = (password: string) => {
    if (password === 'master99') { setIsSuperAdmin(true); setIsAdmin(true); return 'SUPER'; }
    if (password === 'admin123') { setIsAdmin(true); return 'ADMIN'; }
    return 'NONE';
  };

  const logout = () => { setIsAdmin(false); setIsSuperAdmin(false); };

  const addTenant = (tenant: Omit<TenantAccount, 'createdAt' | 'status'>) => {
    const newTenant: TenantAccount = { ...tenant, createdAt: Date.now(), status: 'ACTIVE' };
    setTenants(prev => [...prev, newTenant]);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const deleteTenant = (id: string) => {
    setTenants(prev => prev.filter(t => t.id !== id));
    setTimeout(() => syncWithCloud(true), 100);
  };

  const addMenuItem = (item: MenuItem) => {
    setMenuItems(prev => [...prev, item]);
    addActivity('CREATE', 'MENU_ITEM', `Added dish: ${item.name}`);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const updateMenuItem = (item: MenuItem) => {
    setMenuItems(prev => prev.map(i => i.id === item.id ? item : i));
    addActivity('UPDATE', 'MENU_ITEM', `Updated dish: ${item.name}`);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const deleteMenuItem = (id: string) => {
    const item = menuItems.find(i => i.id === id);
    setMenuItems(prev => prev.filter(i => i.id !== id));
    if (item) addActivity('DELETE', 'MENU_ITEM', `Deleted dish: ${item.name}`);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const addCategory = (name: string) => {
    if (!categories.includes(name)) {
      setCategories(prev => [...prev, name]);
      addActivity('CREATE', 'CATEGORY', `Added category: ${name}`);
      setTimeout(() => syncWithCloud(true), 100);
    }
  };

  const removeCategory = (name: string) => {
    setCategories(prev => prev.filter(c => c !== name));
    setMenuItems(prev => prev.filter(i => i.category !== name));
    addActivity('DELETE', 'CATEGORY', `Removed category: ${name}`);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const renameCategory = (oldName: string, newName: string) => {
    setCategories(prev => prev.map(c => c === oldName ? newName : c));
    setMenuItems(prev => prev.map(i => i.category === oldName ? { ...i, category: newName } : i));
    addActivity('UPDATE', 'CATEGORY', `Renamed category: ${oldName} to ${newName}`);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const updateDiscountMilestones = (milestones: DiscountMilestone[]) => {
    setDiscountMilestones(milestones);
    addActivity('UPDATE', 'PROMOTION', `Updated discount milestones`);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const updateSettings = (newSettings: RestaurantSettings) => {
    setSettings(newSettings);
    addActivity('UPDATE', 'SETTINGS', `Updated restaurant settings`);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const placeOrder = (order: Omit<Order, 'id' | 'status' | 'timestamp'>) => {
    const newOrder: Order = { ...order, id: Math.random().toString(36).substr(2, 6).toUpperCase(), status: 'PENDING', timestamp: Date.now() };
    setOrders(prev => [newOrder, ...prev]);
    setLastPlacedOrder(newOrder);
    notifyOtherTabs();
    setTimeout(() => syncWithCloud(true), 100);
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status, timestamp: Date.now() } : o));
    notifyOtherTabs();
    setTimeout(() => syncWithCloud(true), 100);
  };

  const toggleOrderTakeaway = (orderId: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, isTakeaway: !o.isTakeaway, timestamp: Date.now() } : o));
    notifyOtherTabs();
    setTimeout(() => syncWithCloud(true), 100);
  };

  const clearHistory = () => {
    setActivityLog([]);
    setTimeout(() => syncWithCloud(true), 100);
  };

  const importBusinessData = (data: string) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.menuItems) setMenuItems(parsed.menuItems);
      if (parsed.categories) setCategories(parsed.categories);
      if (parsed.settings) setSettings(parsed.settings);
      if (parsed.discountMilestones) setDiscountMilestones(parsed.discountMilestones);
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

// Export hook to allow other components to access the context
export const useRestaurant = () => {
  const context = useContext(RestaurantContext);
  if (context === undefined) throw new Error('useRestaurant must be used within a RestaurantProvider');
  return context;
};
