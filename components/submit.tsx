"use client"
import { useState, useEffect, useCallback, useReducer } from "react";
import contractService from "../services/contractService";
import web3Service from "../services/web3Service";
import axios from "axios";
import { useWebSocket } from "../hook/useWebSocket";
import { NETWORK_CONFIGS } from "../services/web3Service";
import Web3 from "web3";

// 定义API接口返回的代币地址类型
type TokenAddressResponse = {
  success: boolean;
  data: {
    contractAddress: string;
  };
  message?: string;
};
import { 
    formatTokenAmount, 
    parseTokenAmount, 
    validateTokenAmount, 
    hasSufficientBalance, 
    hasSufficientAllowance,
    formatTxHash,
    formatAddress,
    generateTransactionId
} from "../utils/tokenUtils";
import BridgeProgressBar from "./BridgeProgressBar";
import BurnProgressBar from "./BurnProgressBar";
import {
    CURRENT_ENDPOINTS,
    ERROR_MESSAGES,
    SUCCESS_MESSAGES,
    STATUS_MESSAGES,
} from "../config/constants";

type Token = {
    symbol: string;
    network: string;
    address: string;
};

type SubmitProps = {
    onConnectWallet?: () => void; // 可选的钱包连接回调函数
    receiverAddress?: string; // 可选的接收地址
    amount?: string; // 可选的金额参数
    selectedToken1?: Token; // 可选的源代币信息
    selectedToken2?: Token; // 可选的目标代币信息
};

// WebSocket消息类型
type MintMessage = {
    type: string;
    data?: {
        targetToTxHash?: string;
        unlockTxHash?: string;
        [key: string]: any;
    };
    success?: boolean;
    message?: string;
};

// 定义交易数据类型
type TransactionData = {
    fromAddress: string;
    toAddress: string;
    amount: string;
    sourceFromTxHash: string;
    fee: string | null;
};

// 定义进度步骤类型
type BridgeStep = {
    status: 'pending' | 'active' | 'completed' | 'failed';
    title: string;
    txHash?: string;
};

// 定义状态类型
type State = {
    connected: boolean;
    isProcessing: boolean;
    txHash: string;
    showConfirmDialog: boolean;
    transactionDetails: {
        currentAddress: string;
        receiver: string;
        value: string;
        currentNetwork: string;
    } | null;
    isSendingToBackend: boolean;
    backendResponse: string | null;
    mintStatus: {
        success?: boolean;
        message: string;
        targetToTxHash?: string;
    } | null;
    showMintStatus: boolean;
    walletAddress: string;
    needsAuthorization: boolean;
    isCheckingAuthorization: boolean;
    isAuthorizing: boolean;
    authorizedAmount: string;
    // 代币信息
    sourceToken: Token;
    targetToken: Token;
    // 锁定代币进度条相关状态
    bridgeSteps: {
        lockPending: BridgeStep;
        lockCompleted: BridgeStep;
        mintPending: BridgeStep;
        mintCompleted: BridgeStep;
    };
    currentStep: 'lockPending' | 'lockCompleted' | 'mintPending' | 'mintCompleted' | null;
    // 销毁代币进度条相关状态
    burnSteps: {
        burnPending: BridgeStep;
        burnCompleted: BridgeStep;
        mintPending: BridgeStep;
        mintCompleted: BridgeStep;
    };
    currentBurnStep: 'burnPending' | 'burnCompleted' | 'mintPending' | 'mintCompleted' | null;
};

// 定义动作类型
type Action =
    | { type: 'SET_CONNECTED', payload: boolean }
    | { type: 'SET_PROCESSING', payload: boolean }
    | { type: 'SET_TX_HASH', payload: string }
    | { type: 'SET_SHOW_CONFIRM_DIALOG', payload: boolean }
    | { type: 'SET_TRANSACTION_DETAILS', payload: State['transactionDetails'] }
    | { type: 'SET_SENDING_TO_BACKEND', payload: boolean }
    | { type: 'SET_BACKEND_RESPONSE', payload: string | null }
    | { type: 'SET_MINT_STATUS', payload: State['mintStatus'] }
    | { type: 'SET_SHOW_MINT_STATUS', payload: boolean }
    | { type: 'SET_WALLET_ADDRESS', payload: string }
    | { type: 'SET_SOURCE_TOKEN', payload: Token }
    | { type: 'SET_TARGET_TOKEN', payload: Token }
    | { type: 'HANDLE_WEBSOCKET_MESSAGE', payload: MintMessage }
    | { type: 'SET_CURRENT_STEP', payload: State['currentStep'] }
    | { type: 'UPDATE_BRIDGE_STEP', payload: { step: keyof State['bridgeSteps'], data: Partial<BridgeStep> } }
    | { type: 'PREPARE_BRIDGE_TRANSACTION', payload: State['transactionDetails'] }
    | { type: 'CLEAR_MINT_STATUS' }
    | { type: 'CLOSE_CONFIRM_DIALOG' }
    | { type: 'SET_NEEDS_AUTHORIZATION', payload: boolean }
    | { type: 'SET_CHECKING_AUTHORIZATION', payload: boolean }
    | { type: 'SET_AUTHORIZING', payload: boolean }
    | { type: 'SET_AUTHORIZED_AMOUNT', payload: string }
    | { type: 'SET_CURRENT_BURN_STEP', payload: State['currentBurnStep'] }
    | { type: 'UPDATE_BURN_STEP', payload: { step: keyof State['burnSteps'], data: Partial<BridgeStep> } };

// 定义reducer函数
function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'SET_CONNECTED':
            return { ...state, connected: action.payload };
        case 'SET_PROCESSING':
            return { ...state, isProcessing: action.payload };
        case 'SET_TX_HASH':
            return { ...state, txHash: action.payload };
        case 'SET_SHOW_CONFIRM_DIALOG':
            return { ...state, showConfirmDialog: action.payload };
        case 'SET_TRANSACTION_DETAILS':
            return { ...state, transactionDetails: action.payload };
        case 'SET_SENDING_TO_BACKEND':
            return { ...state, isSendingToBackend: action.payload };
        case 'SET_BACKEND_RESPONSE':
            return { ...state, backendResponse: action.payload };
        case 'SET_MINT_STATUS':
            return { ...state, mintStatus: action.payload };
        case 'SET_SHOW_MINT_STATUS':
            return { ...state, showMintStatus: action.payload };
        case 'SET_WALLET_ADDRESS':
            return { ...state, walletAddress: action.payload };
        case 'SET_SOURCE_TOKEN':
            return { ...state, sourceToken: action.payload };
        case 'SET_TARGET_TOKEN':
            return { ...state, targetToken: action.payload };
        case 'HANDLE_WEBSOCKET_MESSAGE': {
            const data = action.payload;
            let newMintStatus = state.mintStatus;
            
            if (data && typeof data === 'object') {
                // 根据消息类型处理
                if (data.type === 'MINT_SUCCESS') {
                    newMintStatus = {
                        success: true,
                        message: 'Minting successful!',
                        targetToTxHash: data.data?.targetToTxHash
                    };
                    
                    // Update progress bar status - minting successful
                    // Use dispatch function to update progress bar status directly without setTimeout
                    const dispatchAction = (action: Action) => {
                        state = reducer(state, action);
                        return state;
                    };
                    
                    // Update lock token progress bar status - mark mintPending as completed
                    dispatchAction({ 
                        type: 'UPDATE_BRIDGE_STEP', 
                        payload: { 
                            step: 'mintPending', 
                            data: { status: 'completed', txHash: data.data?.targetToTxHash, title: 'Cross-chain communication protocol has been processed' } 
                        } 
                    });
                    
                    // Update lock token progress bar status - mark mintCompleted as completed directly
                    dispatchAction({ 
                        type: 'UPDATE_BRIDGE_STEP', 
                        payload: { 
                            step: 'mintCompleted', 
                            data: { status: 'completed', txHash: data.data?.targetToTxHash, title: `[${state.targetToken.network}] ${state.targetToken.symbol} mint successfully` } 
                        } 
                    });
                    dispatchAction({ type: 'SET_CURRENT_STEP', payload: 'mintCompleted' });
                    
                    // Update burn token progress bar status - mark mintPending as completed
                    dispatchAction({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'mintPending', 
                            data: { status: 'completed', txHash: data.data?.targetToTxHash, title: 'Cross-chain communication protocol has been processed' } 
                        } 
                    });
                    
                    // Update burn token progress bar status - mark mintCompleted as completed directly
                    dispatchAction({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'mintCompleted', 
                            data: { status: 'completed', txHash: data.data?.targetToTxHash, title: `[${state.targetToken.network}] ${state.targetToken.symbol} unlock successfully` } 
                        } 
                    });
                    dispatchAction({ type: 'SET_CURRENT_BURN_STEP', payload: 'mintCompleted' });
                    
                    // 铸币成功后触发余额刷新
                    console.log('MINT_SUCCESS: 触发余额检查');
                    setTimeout(() => {
                        if (typeof window !== 'undefined') {
                            const event = new CustomEvent('refreshBalance', {
                                detail: { operationType: 'mint', targetToken: state.targetToken }
                            });
                            document.dispatchEvent(event);
                        }
                    }, 1000);
                } else if (data.type === 'MINT_FAILURE') {
                    newMintStatus = {
                        success: false,
                        message: data.message || 'Minting failed',
                        targetToTxHash: data.data?.targetToTxHash
                    };
                    
                    // Update progress bar status - minting failed
                    // Use dispatch function to update progress bar status directly without setTimeout
                    const dispatchAction = (action: Action) => {
                        state = reducer(state, action);
                        return state;
                    };
                    
                    // Update lock token progress bar status - minting failed
                    dispatchAction({ 
                        type: 'UPDATE_BRIDGE_STEP', 
                        payload: { 
                            step: 'mintPending', 
                            data: { status: 'failed', txHash: data.data?.targetToTxHash, title: 'Cross-chain communication protocol processing failed' } 
                        } 
                    });
                    dispatchAction({ 
                        type: 'UPDATE_BRIDGE_STEP', 
                        payload: { 
                            step: 'mintCompleted', 
                            data: { status: 'failed', txHash: data.data?.targetToTxHash, title: `[${state.targetToken.network}] ${state.targetToken.symbol} mint failed` } 
                        } 
                    });
                    
                    // Update burn token progress bar status - minting failed
                    dispatchAction({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'mintPending', 
                            data: { status: 'failed', txHash: data.data?.targetToTxHash, title: 'Cross-chain communication protocol processing failed' } 
                        } 
                    });
                    dispatchAction({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'mintCompleted', 
                            data: { status: 'failed', txHash: data.data?.targetToTxHash, title: `[${state.targetToken.network}] ${state.targetToken.symbol} unlock failed` } 
                        } 
                    });
                } else if (data.type === 'UNLOCK_SUCCESS') {
                    newMintStatus = {
                        success: true,
                        message: 'Unlock successful!',
                        targetToTxHash: data.data?.unlockTxHash
                    };
                    
                    // Update progress bar status - unlock successful
                    // Use dispatch function to update progress bar status directly without setTimeout
                    const dispatchAction = (action: Action) => {
                        state = reducer(state, action);
                        return state;
                    };
                    
                    // Update burn token progress bar status - mark mintPending as completed
                    dispatchAction({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'mintPending', 
                            data: { status: 'completed', txHash: data.data?.unlockTxHash, title: 'Cross-chain communication protocol has been processed' } 
                        } 
                    });
                    
                    // Update burn token progress bar status - mark mintCompleted as completed directly
                    dispatchAction({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'mintCompleted', 
                            data: { status: 'completed', txHash: data.data?.unlockTxHash, title: `[${state.targetToken.network}] ${state.targetToken.symbol} unlock successfully` } 
                        } 
                    });
                    dispatchAction({ type: 'SET_CURRENT_BURN_STEP', payload: 'mintCompleted' });
                    
                    // 解锁成功后触发余额刷新
                    console.log('UNLOCK_SUCCESS: 触发余额检查');
                    setTimeout(() => {
                        if (typeof window !== 'undefined') {
                            const event = new CustomEvent('refreshBalance', {
                                detail: { operationType: 'unlock', targetToken: state.targetToken }
                            });
                            document.dispatchEvent(event);
                        }
                    }, 1000);
                } else {
                    // Handle other types of messages
                    newMintStatus = {
                        success: data.success,
                        message: data.message || 'Received minting status update',
                        targetToTxHash: data.data?.targetToTxHash
                    };
                }
                
                return {
                    ...state,
                    mintStatus: newMintStatus,
                    showMintStatus: true,
                    isProcessing: state.isProcessing ? false : state.isProcessing
                };
            }
            return state;
        }
        case 'PREPARE_BRIDGE_TRANSACTION':
            return {
                ...state,
                transactionDetails: action.payload,
                showConfirmDialog: true
            };
        case 'CLEAR_MINT_STATUS':
            return {
                ...state,
                mintStatus: null,
                showMintStatus: false
            };
        case 'CLOSE_CONFIRM_DIALOG':
            return {
                ...state,
                showConfirmDialog: false
            };
        case 'SET_CURRENT_STEP':
            return {
                ...state,
                currentStep: action.payload
            };
        case 'UPDATE_BRIDGE_STEP':
            return {
                ...state,
                bridgeSteps: {
                    ...state.bridgeSteps,
                    [action.payload.step]: {
                        ...state.bridgeSteps[action.payload.step],
                        ...action.payload.data
                    }
                }
            };
        case 'SET_NEEDS_AUTHORIZATION':
            return {
                ...state,
                needsAuthorization: action.payload
            };
        case 'SET_CHECKING_AUTHORIZATION':
            return {
                ...state,
                isCheckingAuthorization: action.payload
            };
        case 'SET_AUTHORIZING':
            return {
                ...state,
                isAuthorizing: action.payload
            };
        case 'SET_AUTHORIZED_AMOUNT':
            return {
                ...state,
                authorizedAmount: action.payload
            };
        case 'SET_CURRENT_BURN_STEP':
            return {
                ...state,
                currentBurnStep: action.payload
            };
        case 'UPDATE_BURN_STEP':
            return {
                ...state,
                burnSteps: {
                    ...state.burnSteps,
                    [action.payload.step]: {
                        ...state.burnSteps[action.payload.step],
                        ...action.payload.data
                    }
                }
            };
        default:
            return state;
    }
}

// 检查两个代币是否是同名代币（不同网络上的相同代币）
function isSameNamedToken(token1: Token, token2: Token): boolean {
    // 检查代币符号是否相同但网络不同
    return token1.symbol === token2.symbol && token1.network !== token2.network;
}

// 获取代币在目标网络上的对应合约地址
async function getTargetTokenAddress(sourceToken: Token, targetNetwork: string): Promise<string> {
    // 如果代币地址已经存在，直接返回
    if (sourceToken.address) {
        return sourceToken.address;
    }
    
    try {
        // 尝试从contractService获取代币地址
        const tokenAddress = contractService.getTokenAddress(sourceToken.network, sourceToken.symbol, targetNetwork);
        if (tokenAddress) {
            console.log(`Found token address from contractService: ${tokenAddress}`);
            return tokenAddress;
        }
        
        // 如果contractService中没有，尝试通过API获取
        try {
            console.log(`Attempting to get token address from API for ${sourceToken.symbol} on ${targetNetwork}`);
            // 使用CURRENT_ENDPOINTS中定义的API端点
            const response = await axios.get<TokenAddressResponse>(`${CURRENT_ENDPOINTS.CROSS_LOCK_INFO.replace('/crossLockInfo', '')}/token-address`, {
                params: {
                    fromNetwork: sourceToken.network,
                    toNetwork: targetNetwork,
                    tokenSymbol: sourceToken.symbol
                }
            });
            
            if (response.data.success) {
                console.log(`Found token address from API: ${response.data.data.contractAddress}`);
                return response.data.data.contractAddress;
            }
        } catch (apiError) {
            console.error("Error getting token address from API:", apiError);
            
            // 尝试使用本地API端点
            try {
                const response = await axios.get<TokenAddressResponse>(`/api/token-address`, {
                    params: {
                        fromNetwork: sourceToken.network,
                        toNetwork: targetNetwork,
                        tokenSymbol: sourceToken.symbol
                    }
                });
                
                if (response.data.success) {
                    console.log(`Found token address from local API: ${response.data.data.contractAddress}`);
                    return response.data.data.contractAddress;
                }
            } catch (localApiError) {
                console.error("Error getting token address from local API:", localApiError);
            }
        }
        
        return '';
    } catch (error) {
        console.error('获取目标网络代币地址失败:', error);
        return '';
    }
}

export default function Submit({ onConnectWallet, receiverAddress, amount, selectedToken1, selectedToken2 }: SubmitProps) {
    // 设置默认的代币信息
    const defaultToken1: Token = { symbol: "ETH", network: "Ethereum-Sepolia", address: "" };
    const defaultToken2: Token = { symbol: "maoETH", network: "Imua-Testnet", address: "0x4a91a4a24b6883dbbddc6e6704a3c0e96396d2e9" };
    
    // 使用传入的代币信息或默认值
    const sourceToken = selectedToken1 || defaultToken1;
    const targetToken = selectedToken2 || defaultToken2;
    // 初始状态
    const initialState: State = {
        connected: false,
        isProcessing: false,
        txHash: "",
        showConfirmDialog: false,
        transactionDetails: null,
        isSendingToBackend: false,
        backendResponse: null,
        mintStatus: null,
        showMintStatus: false,
        walletAddress: "",
        needsAuthorization: false,
        isCheckingAuthorization: false,
        isAuthorizing: false,
        authorizedAmount: "0",
        // 代币信息
        sourceToken: sourceToken,
        targetToken: targetToken,
        // Initialize lock token progress bar status
        bridgeSteps: {
            lockPending: {
                status: 'pending',
                title: 'Wait for user wallet confirmation signature'
            },
            lockCompleted: {
                status: 'pending',
                title: `[${sourceToken.network}] ${sourceToken.symbol} is locking...`
            },
            mintPending: {
                status: 'pending',
                title: 'Cross-chain communication protocol is being processed'
            },
            mintCompleted: {
                status: 'pending',
                title: `[${targetToken.network}] ${targetToken.symbol} is minting...`
            }
        },
        currentStep: null,
        // Initialize burn token progress bar status
        burnSteps: {
            burnPending: {
                status: 'pending',
                title: 'Wait for user wallet confirmation signature'
            },
            burnCompleted: {
                status: 'pending',
                title: `[${sourceToken.network}] ${sourceToken.symbol} is burning...`
            },
            mintPending: {
                status: 'pending',
                title: 'Cross-chain communication protocol is being processed'
            },
            mintCompleted: {
                status: 'pending',
                title: `[${targetToken.network}] ${targetToken.symbol} is unlocking...`
            }
        },
        currentBurnStep: null
    };
    
    // 使用useReducer替代多个useState
    const [state, dispatch] = useReducer(reducer, initialState);
    
    // 处理WebSocket消息 - 使用useCallback缓存函数，避免不必要的重新创建
    const handleWebSocketMessage = useCallback((data: MintMessage) => {
        console.log('Received WebSocket message:', data);
        dispatch({ type: 'HANDLE_WEBSOCKET_MESSAGE', payload: data });
    }, []);
    
    // Update wallet address when connection status changes
    useEffect(() => {
        if (typeof window !== "undefined") {
            const savedAddress = localStorage.getItem("walletAddress") || "";
            dispatch({ type: 'SET_WALLET_ADDRESS', payload: savedAddress });
        }
    }, [state.connected]);
    
    // Update token information when props change
    useEffect(() => {
        dispatch({ type: 'SET_SOURCE_TOKEN', payload: sourceToken });
        dispatch({ type: 'SET_TARGET_TOKEN', payload: targetToken });
    }, [sourceToken, targetToken]);
    
    // 检查授权状态
    const checkAuthorization = async () => {
        // 如果是原生代币(没有合约地址)或者没有金额或钱包地址，不需要授权
        const isNative = !sourceToken.address || sourceToken.address === '';
        if (isNative || !amount || !state.walletAddress) {
            dispatch({ type: 'SET_NEEDS_AUTHORIZATION', payload: false });
            return;
        }

        dispatch({ type: 'SET_CHECKING_AUTHORIZATION', payload: true });
        try {
            // 获取当前网络
            const currentNetwork = await web3Service.getCurrentNetwork();
            
            // 获取合约地址 - 根据代币类型选择不同的合约
            let contractAddress;
            if (sourceToken.symbol.startsWith('mao')) {
                // 对于mao代币，使用销毁合约地址
                contractAddress = contractService.getBurnContractAddress(currentNetwork, sourceToken.symbol, targetToken.network);
                if (!contractAddress) {
                    throw new Error(`Network ${currentNetwork} does not have a configured burn contract address`);
                }
            } else {
                // 对于非mao代币，使用锁定合约地址
                contractAddress = contractService.getLockContractAddress(currentNetwork);
                if (!contractAddress) {
                    throw new Error(`Network ${currentNetwork} does not have a configured lock contract address`);
                }
            }
            
            // 检查授权额度
            const authorizedAmount = await contractService.checkAllowance(
                sourceToken.address,
                state.walletAddress,
                contractAddress
            );
            
            dispatch({ type: 'SET_AUTHORIZED_AMOUNT', payload: authorizedAmount });
            
            // 检查授权额度是否足够 - 使用与提交时相同的比较逻辑
            const needsAuth = !hasSufficientAllowance(authorizedAmount, amount);
            dispatch({ type: 'SET_NEEDS_AUTHORIZATION', payload: needsAuth });
            console.log(`钱包地址: ${state.walletAddress}`);
            console.log(`代币地址: ${sourceToken.address}`);
            console.log(`授权额度: ${authorizedAmount}, 需要额度: ${amount}, 需要授权: ${needsAuth}`);
            
            // 同时向后端发送请求（为了兼容性）
            try {
                const chainId = await web3Service.getCurrentChainId();
                await axios.post(CURRENT_ENDPOINTS.GET_AMOUNT, {
                    address: state.walletAddress,
                    contractAddress: sourceToken.address,
                    chainId: chainId,
                    tokenSymbol: sourceToken.symbol,
                    networkName: sourceToken.network
                });
            } catch (backendError) {
                console.warn('Failed to sync with backend:', backendError);
                // 如果是404错误（记录不存在），将结果视为0
                if ((backendError as any).response && (backendError as any).response.status === 404) {
                    console.log('Record not found, treating authorized amount as 0');
                    dispatch({ type: 'SET_AUTHORIZED_AMOUNT', payload: '0' });
                    dispatch({ type: 'SET_NEEDS_AUTHORIZATION', payload: true });
                }
                // 不影响主流程
            }
            
        } catch (error) {
            console.error('Failed to check authorization:', error);
            // 如果检查失败，假设需要授权
            dispatch({ type: 'SET_NEEDS_AUTHORIZATION', payload: true });
            dispatch({ type: 'SET_AUTHORIZED_AMOUNT', payload: '0' });
        } finally {
            dispatch({ type: 'SET_CHECKING_AUTHORIZATION', payload: false });
        }
    };

    // Check authorization status when token, amount, or wallet address changes
    useEffect(() => {
        checkAuthorization();
    }, [sourceToken.symbol, sourceToken.address, amount, state.walletAddress]);
    
    // 使用更新后的useWebSocket钩子，获取连接状态和重连方法
    const { isConnected, reconnect } = useWebSocket(handleWebSocketMessage, state.walletAddress);

    // 处理授权请求
    const handleAuthorization = async () => {
        if (!amount || !state.walletAddress) {
            alert('Please ensure wallet is connected and amount is entered');
            return;
        }

        // 检查是否为原生代币，原生代币不需要授权
        const isNative = !sourceToken.address || sourceToken.address === '';
        if (isNative) {
            alert('Native tokens do not require authorization');
            return;
        }

        dispatch({ type: 'SET_AUTHORIZING', payload: true });
        try {
            // 获取当前网络
            const currentNetwork = await web3Service.getCurrentNetwork();
            
            // 获取合约地址 - 根据代币类型选择不同的合约
            let contractAddress;
            if (sourceToken.symbol.startsWith('mao')) {
                // 对于mao代币，使用销毁合约地址
                contractAddress = contractService.getBurnContractAddress(currentNetwork, sourceToken.symbol, targetToken.network);
                if (!contractAddress) {
                    throw new Error(`Network ${currentNetwork} does not have a configured burn contract address`);
                }
            } else {
                // 对于非mao代币，使用锁定合约地址
                contractAddress = contractService.getLockContractAddress(currentNetwork);
                if (!contractAddress) {
                    throw new Error(`Network ${currentNetwork} does not have a configured lock contract address`);
                }
            }
            
            // 检查代币余额
            const tokenBalance = await contractService.getTokenBalance(
                sourceToken.address,
                state.walletAddress
            );
            
            // 检查余额是否足够 - 使用与提交时相同的比较逻辑
            if (!hasSufficientBalance(tokenBalance, amount)) {
                throw new Error(`Insufficient token balance. Current balance: ${tokenBalance} ${sourceToken.symbol}`);
            }
            
            // 调用合约服务进行授权
            const txHash = await contractService.approveToken(
                sourceToken.address,
                contractAddress,
                amount
            );
            
            console.log('Authorization transaction hash:', txHash);
            
            // 授权成功后向后端发送信息
            await sendAuthorizationToBackend({
                contractAddress: sourceToken.address,
                chainId: await web3Service.getCurrentChainId(),
                chainName: sourceToken.network,
                amount: amount,
                address: state.walletAddress,
            });
            
            // 授权交易已提交，等待用户关闭弹窗时再检查授权状态
            // 移除自动检查，避免与弹窗关闭时的检查重复
            
            // 显示授权成功弹窗
            dispatch({ 
                type: 'SET_MINT_STATUS', 
                payload: {
                    success: true,
                    message: 'Authorization successful!',
                    targetToTxHash: undefined // 不显示交易哈希
                }
            });
            dispatch({ type: 'SET_SHOW_MINT_STATUS', payload: true });
            
        } catch (error) {
            console.error('Authorization failed:', error);
            alert('Authorization failed: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
            dispatch({ type: 'SET_AUTHORIZING', payload: false });
        }
    };

    // 发送授权信息到后端
    const sendAuthorizationToBackend = async (authData: {
        chainId: string;
        chainName: string;
        contractAddress: string;
        address: string;
        amount: string;
    }) => {
        try {
            const response = await axios.post(CURRENT_ENDPOINTS.ADD_AUTHORIZATION, {
                ...authData,
            });
            console.log('Authorization data sent to backend:', response.data);
        } catch (error) {
            console.error('Failed to send authorization data to backend:', error);
            // Don't throw error because the authorization itself was successful
        }
    };

    // 处理弹窗关闭事件
    const handleMintStatusClose = async () => {
        // 如果是授权成功弹窗，关闭时执行授权检查
        if (state.mintStatus && state.mintStatus.message.includes('Authorization')) {
            console.log('Authorization popup closed, performing authorization check...');
            await checkAuthorization();
        }
        dispatch({ type: 'SET_SHOW_MINT_STATUS', payload: false });
    };
    
    // 在用户交互时触发WebSocket重连
    const triggerReconnect = useCallback(() => {
        if (!isConnected && state.walletAddress) {
            console.log('User interaction detected, attempting to reconnect WebSocket');
            reconnect();
        }
    }, [isConnected, state.walletAddress, reconnect]);
    
    // 监听用户交互事件
    useEffect(() => {
        const userInteractionEvents = ['mousedown', 'keydown', 'touchstart'];
        
        const handleUserInteraction = () => {
            triggerReconnect();
        };
        
        userInteractionEvents.forEach(event => {
            document.addEventListener(event, handleUserInteraction);
        });
        
        return () => {
            userInteractionEvents.forEach(event => {
                document.removeEventListener(event, handleUserInteraction);
            });
        };
    }, [triggerReconnect]);
    
    // 从localStorage检查钱包连接状态
    useEffect(() => {
        if (typeof window !== "undefined") {
            const savedAddress = localStorage.getItem("walletAddress");
            dispatch({ type: 'SET_CONNECTED', payload: !!savedAddress });
            
            // Listen for localStorage changes
            const handleStorageChange = () => {
                const currentAddress = localStorage.getItem("walletAddress") || "";
                dispatch({ type: 'SET_CONNECTED', payload: !!currentAddress });
                dispatch({ type: 'SET_WALLET_ADDRESS', payload: currentAddress });
            };
            
            // Create custom event listener for cross-component communication
            window.addEventListener("storage", handleStorageChange);
            document.addEventListener("walletChanged", handleStorageChange);
            
            return () => {
                window.removeEventListener("storage", handleStorageChange);
                document.removeEventListener("walletChanged", handleStorageChange);
            };
        }
    }, []);
    
    // Handle connect wallet button click
    function handleConnectClick() {
        // Try to reconnect WebSocket
        triggerReconnect();
        
        // If onConnectWallet callback is provided, call it
        if (onConnectWallet) {
            onConnectWallet();
        } else {
            // Otherwise, trigger a custom event to notify header component to show wallet dropdown
            const event = new CustomEvent("showWalletDropdown");
            document.dispatchEvent(event);
        }
    }
    
    // Handle Bridge button click - show confirmation dialog
    async function handleBridgeClick() {
        // Try to reconnect WebSocket
        triggerReconnect();
        
        if (!window.ethereum) {
            alert("Please install MetaMask or other compatible wallet!");
            return;
        }
        
        try {
            // Get current connected wallet address
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            const currentAddress = web3Service.web3?.utils.toChecksumAddress(accounts[0]) || accounts[0];
            
            // Determine receiver address, use current wallet address if not provided
            const receiver = receiverAddress || currentAddress;
            
            // Get current network
            const currentNetwork = await web3Service.getCurrentNetwork();
            
            // Determine sending amount, use default value if not provided
            const value = amount || '';
            
            // Set transaction details and show confirmation dialog
            dispatch({ 
                type: 'PREPARE_BRIDGE_TRANSACTION', 
                payload: {
                    currentAddress,
                    receiver,
                    value,
                    currentNetwork
                }
            });
            
        } catch (error) {
            console.error("Prepare lock operation failed:", error);
            alert("Prepare lock operation failed: " + (error instanceof Error ? error.message : String(error)));
        }
    }
    
    // Confirm lock operation
    async function confirmBridgeTransaction() {
        if (!state.transactionDetails) return;
        
        dispatch({ type: 'SET_SHOW_CONFIRM_DIALOG', payload: false });
        dispatch({ type: 'SET_PROCESSING', payload: true });
        
        // Clear previous status
        dispatch({ type: 'CLEAR_MINT_STATUS' });
        
        // Reset progress bar status
        dispatch({ 
            type: 'UPDATE_BRIDGE_STEP', 
            payload: { 
                step: 'lockPending', 
                data: { status: 'active', title: 'Wait for user wallet confirmation signature', txHash: undefined } 
            } 
        });
        dispatch({ 
            type: 'UPDATE_BRIDGE_STEP', 
            payload: { 
                step: 'lockCompleted', 
                data: { status: 'pending', title: `[${sourceToken.network}] ${sourceToken.symbol} is locking...`, txHash: undefined } 
            } 
        });
        dispatch({ 
            type: 'UPDATE_BRIDGE_STEP', 
            payload: { 
                step: 'mintPending', 
                data: { status: 'pending', title: 'Cross-chain communication protocol is being processed', txHash: undefined } 
            } 
        });
        dispatch({ 
            type: 'UPDATE_BRIDGE_STEP', 
            payload: { 
                step: 'mintCompleted', 
                data: { status: 'pending', title: `[${targetToken.network}] ${targetToken.symbol} is minting...`, txHash: undefined } 
            } 
        });
        dispatch({ type: 'SET_CURRENT_STEP', payload: 'lockPending' });
        
        try {
            const { currentAddress, receiver, value, currentNetwork } = state.transactionDetails;
            
            console.log("Bridge operation started:");
            console.log("- Current network:", currentNetwork);
            console.log("- Sender address:", currentAddress);
            console.log("- Receiver address:", receiver);
            console.log("- Amount:", value);
            console.log("- Source token:", sourceToken.symbol, sourceToken.address);
            console.log("- Target token:", targetToken.symbol, targetToken.address);
            
            // 检查是否是同名代币（不同网络上的相同代币）
            const isSameTokenType = isSameNamedToken(sourceToken, targetToken);
            console.log("- Is same named token:", isSameTokenType);
            
            // 如果是同名代币，确保目标代币地址正确
            if (isSameTokenType && !targetToken.address) {
                const targetAddress = await getTargetTokenAddress(sourceToken, targetToken.network);
                if (targetAddress) {
                    console.log("- Found target token address for same named token:", targetAddress);
                    // 更新目标代币地址
                    targetToken.address = targetAddress;
                }
            }
            
            // Validate network configuration
            const networkConfig = contractService.validateNetworkConfig(currentNetwork);
            console.log("Network configuration:", networkConfig);
            
            // Show processing status
            dispatch({ 
                    type: 'SET_MINT_STATUS', 
                    payload: {
                        message: STATUS_MESSAGES.PREPARING_TRANSACTION
                    }
                });
            dispatch({ type: 'SET_SHOW_MINT_STATUS', payload: true });
            
            // Check if network configuration is complete
            if (!networkConfig.lockContractAddress && !contractService.getBurnContractAddress(currentNetwork)) {
                throw new Error(`Network ${currentNetwork} configuration is incomplete, missing contract address`);
            }
            
            // Choose contract operation based on token type and authorization status
            let result;
            if (sourceToken.symbol.startsWith('mao') && hasSufficientAllowance(state.authorizedAmount, value)) {
                // If it's a mao token and has sufficient authorization, call the burn contract
                const burnContractAddress = contractService.getBurnContractAddress(currentNetwork, sourceToken.symbol, targetToken.network);
                if (!burnContractAddress) {
                    throw new Error(`Network ${currentNetwork} does not support burn operation for ${sourceToken.symbol}`);
                }
                
                // Initialize burn progress bar status
                dispatch({ 
                    type: 'UPDATE_BURN_STEP', 
                    payload: { 
                        step: 'burnPending', 
                        data: { 
                            status: 'active',
                            title: 'Waiting for user wallet confirmation signature'
                        } 
                    } 
                });
                dispatch({ 
                    type: 'UPDATE_BURN_STEP', 
                    payload: { 
                        step: 'burnCompleted', 
                        data: { status: 'pending' } 
                    } 
                });
                dispatch({ 
                    type: 'UPDATE_BURN_STEP', 
                    payload: { 
                        step: 'mintPending', 
                        data: { status: 'pending' } 
                    } 
                });
                dispatch({ 
                    type: 'UPDATE_BURN_STEP', 
                    payload: { 
                        step: 'mintCompleted', 
                        data: { status: 'pending' } 
                    } 
                });
                dispatch({ type: 'SET_CURRENT_BURN_STEP', payload: 'burnPending' });
                
                dispatch({ 
                     type: 'SET_MINT_STATUS', 
                     payload: {
                         message: "Checking token information..."
                     }
                 });
                
                // Get token information
                const tokenName = await contractService.getTokenName(sourceToken.address);
                const tokenSymbol = await contractService.getTokenSymbol(sourceToken.address);
                const tokenDecimals = await contractService.getTokenDecimals(sourceToken.address);
                
                console.log(`Token info: ${tokenName} (${tokenSymbol}), decimals: ${tokenDecimals}`);
                
                // Check authorization status again to ensure safety
                const currentAllowance = await contractService.checkAllowance(
                    sourceToken.address,
                    currentAddress,
                    burnContractAddress
                );
                
                // Check token balance
                const tokenBalance = await contractService.getTokenBalance(
                    sourceToken.address,
                    currentAddress
                );
                
                console.log("Current allowance:", currentAllowance);
                console.log("Token balance:", tokenBalance);
                
                // Validate input amount format
                const validation = validateTokenAmount(value, tokenDecimals);
                if (!validation.isValid) {
                    throw new Error(validation.error || 'Invalid amount format');
                }
                
                // Format amount for comparison
                // Ensure using the same format for comparison
                // If currentAllowance is in wei format, convert value to wei format as well
                const formattedValue = parseTokenAmount(value, tokenDecimals);
                // Convert wei format value to ether unit for subsequent comparison
                // Use Web3 instance directly from tokenUtils to avoid dependency on web3Service.web3
                const web3 = new Web3();
                // 根据代币精度从wei格式转换
                let formattedValueInEther: string;
                if (tokenDecimals === 18) {
                    // 使用web3.utils.fromWei仅适用于18位精度的代币
                    formattedValueInEther = web3.utils.fromWei(formattedValue, 'ether');
                } else {
                    // 对于非18位精度的代币，手动计算
                    const amountBN = BigInt(formattedValue);
                    formattedValueInEther = (Number(amountBN) / Math.pow(10, tokenDecimals)).toString();
                }
                
                // Use utility functions to check authorization and balance
                console.log("Authorization comparison:", "Current authorization (original value):", currentAllowance, "Required amount (original value):", formattedValue);
                console.log("Authorization comparison:", "Current authorization (formatted):", formatTokenAmount(currentAllowance, tokenDecimals), "Required amount (formatted):", formatTokenAmount(formattedValue, tokenDecimals));
                
                // Ensure using the correct format for comparison
                // currentAllowance is in ether unit (returned from checkAllowance), needs to be compared with formattedValueInEther (also in ether unit)
                console.log("Comparison after unit standardization:", "Current authorization (ether unit):", currentAllowance, "Required amount (ether unit):", formattedValueInEther);
                
                const hasAllowance = hasSufficientAllowance(currentAllowance, formattedValueInEther);
                console.log("Is authorization sufficient:", hasAllowance);
                
                if (!hasAllowance) {
                    // Ensure using the correct formatting method
                    // currentAllowance and formattedValueInEther are both in ether unit, format directly
                    const displayAllowance = formatTokenAmount(currentAllowance, tokenDecimals);
                    const displayValue = formatTokenAmount(formattedValueInEther, tokenDecimals);
                    console.log(`Values in error message: Current authorization=${displayAllowance}, Required=${displayValue}`);
                    throw new Error(`Insufficient authorization, current authorization: ${displayAllowance} ${tokenSymbol}, required: ${displayValue} ${tokenSymbol}`);
                }
                
                // Check if balance is sufficient
                console.log("Balance comparison:", "Current balance (original value):", tokenBalance, "Required amount (original value):", formattedValue);
                console.log("Balance comparison:", "Current balance (formatted):", formatTokenAmount(tokenBalance, tokenDecimals), "Required amount (formatted):", formatTokenAmount(formattedValue, tokenDecimals));
                
                // Ensure using the same unit for comparison
                // tokenBalance is in ether unit (returned from getTokenBalance), needs to be compared with formattedValueInEther
                console.log("Comparison after unit standardization:", "Current balance (ether unit):", tokenBalance, "Required amount (ether unit):", formattedValueInEther);
                
                const hasBalance = hasSufficientBalance(tokenBalance, formattedValueInEther);
                console.log("Is balance sufficient:", hasBalance);
                
                if (!hasBalance) {
                    // Ensure using the correct formatting method
                    // tokenBalance and formattedValueInEther are both in ether unit, format directly
                    const displayBalance = formatTokenAmount(tokenBalance, tokenDecimals);
                    const displayValue = formatTokenAmount(formattedValueInEther, tokenDecimals);
                    console.log(`Values in error message: Current balance=${displayBalance}, Required=${displayValue}`);
                    throw new Error(`Insufficient token balance, current balance: ${displayBalance} ${tokenSymbol}, required: ${displayValue} ${tokenSymbol}`);
                }
                
                dispatch({ 
                    type: 'SET_MINT_STATUS', 
                    payload: {
                        message: `Burning ${value} ${tokenSymbol}...`
                    }
                });
                
                // 获取目标网络信息，用于销毁操作
                // 从targetToken.network中提取目标网络名称
                const targetNetworkName = targetToken.network;
                
                result = await contractService.burnTokens({
                    networkName: currentNetwork,
                    sender: currentAddress,
                    receiver: receiver,
                    amount: formattedValue,
                    tokenAddress: sourceToken.address,
                    tokenSymbol: sourceToken.symbol, // 添加代币符号参数
                    targetNetwork: targetNetworkName // 添加目标网络参数
                });
            } else {
                // Otherwise call the lock contract
                if (!networkConfig.lockContractAddress) {
                    throw new Error(`Network ${currentNetwork} does not support lock operation`);
                }
                
                dispatch({ 
                     type: 'SET_MINT_STATUS', 
                     payload: {
                         message: STATUS_MESSAGES.PROCESSING_BRIDGE
                     }
                 });
                
                // 判断是否为原生代币 (ETH, LAT等没有合约地址的代币)
                const isNative = !sourceToken.address || sourceToken.address === '';
                
                // 如果不是原生代币，需要检查授权
                if (!isNative) {
                    // 获取锁定合约地址
                    const lockContractAddress = contractService.getLockContractAddress(currentNetwork);
                    if (!lockContractAddress) {
                        throw new Error(`Network ${currentNetwork} does not have a configured lock contract address`);
                    }
                    
                    // 获取代币信息
                    const tokenName = await contractService.getTokenName(sourceToken.address);
                    const tokenSymbol = await contractService.getTokenSymbol(sourceToken.address);
                    const tokenDecimals = await contractService.getTokenDecimals(sourceToken.address);
                    
                    console.log(`Token info: ${tokenName} (${tokenSymbol}), decimals: ${tokenDecimals}`);
                    
                    // 检查授权状态
                    const currentAllowance = await contractService.checkAllowance(
                        sourceToken.address,
                        currentAddress,
                        lockContractAddress
                    );
                    
                    // 检查代币余额
                    const tokenBalance = await contractService.getTokenBalance(
                        sourceToken.address,
                        currentAddress
                    );
                    
                    console.log("Current allowance:", currentAllowance);
                    console.log("Token balance:", tokenBalance);
                    
                    // 验证输入金额格式
                    const validation = validateTokenAmount(value, tokenDecimals);
                    if (!validation.isValid) {
                        throw new Error(validation.error || 'Invalid amount format');
                    }
                    
                    // 格式化金额用于比较
                    const formattedValue = parseTokenAmount(value, tokenDecimals);
                    const web3 = new Web3();
                    // 根据代币精度从wei格式转换
                    let formattedValueInEther: string;
                    if (tokenDecimals === 18) {
                        // 使用web3.utils.fromWei仅适用于18位精度的代币
                        formattedValueInEther = web3.utils.fromWei(formattedValue, 'ether');
                    } else {
                        // 对于非18位精度的代币，手动计算
                        const amountBN = BigInt(formattedValue);
                        formattedValueInEther = (Number(amountBN) / Math.pow(10, tokenDecimals)).toString();
                    }
                    
                    // 检查授权是否足够
                    console.log("Authorization comparison:", "Current authorization:", currentAllowance, "Required amount:", formattedValueInEther);
                    const hasAllowance = hasSufficientAllowance(currentAllowance, formattedValueInEther);
                    console.log("Is authorization sufficient:", hasAllowance);
                    
                    if (!hasAllowance) {
                        const displayAllowance = formatTokenAmount(currentAllowance, tokenDecimals);
                        const displayValue = formatTokenAmount(formattedValueInEther, tokenDecimals);
                        throw new Error(`Insufficient authorization, current authorization: ${displayAllowance} ${tokenSymbol}, required: ${displayValue} ${tokenSymbol}`);
                    }
                    
                    // 检查余额是否足够
                    console.log("Balance comparison:", "Current balance:", tokenBalance, "Required amount:", formattedValueInEther);
                    const hasBalance = hasSufficientBalance(tokenBalance, formattedValueInEther);
                    console.log("Is balance sufficient:", hasBalance);
                    
                    if (!hasBalance) {
                        const displayBalance = formatTokenAmount(tokenBalance, tokenDecimals);
                        const displayValue = formatTokenAmount(formattedValueInEther, tokenDecimals);
                        throw new Error(`Insufficient token balance, current balance: ${displayBalance} ${tokenSymbol}, required: ${displayValue} ${tokenSymbol}`);
                    }
                }
                
                // 获取目标网络信息，与burnTokens函数类似
                const targetNetworkName = targetToken.network;
                
                // 处理特殊情况：IMUA链上的maoUSDC地址需要根据目标网络动态选择
                let tokenAddress = sourceToken.address;
                console.log(`[LOCK TOKENS] Initial tokenAddress: ${tokenAddress}`);
                console.log(`[LOCK TOKENS] Source token details:`, {
                    symbol: sourceToken.symbol,
                    network: sourceToken.network,
                    address: sourceToken.address,
                    isNative: isNative
                });
                console.log(`[LOCK TOKENS] Target network: ${targetNetworkName}`);
                
                if (!isNative && sourceToken.network === 'Imua-Testnet' && sourceToken.symbol === 'maoUSDC') {
                    console.log(`[MAOUSDC LOCK] Detected maoUSDC on IMUA chain, getting dynamic address for target network: ${targetNetworkName}`);
                    console.log(`[MAOUSDC LOCK] Timestamp: ${new Date().toISOString()}`);
                    
                    // 确保使用正确的maoUSDC地址
                    const dynamicAddress = contractService.getTokenContractAddress(
                        sourceToken.network, 
                        sourceToken.symbol, 
                        targetNetworkName
                    );
                    
                    console.log(`[MAOUSDC LOCK] getTokenContractAddress result: ${dynamicAddress || 'null'}`);
                    
                    if (dynamicAddress) {
                        const addressChanged = tokenAddress !== dynamicAddress;
                        tokenAddress = dynamicAddress;
                        console.log(`[MAOUSDC LOCK] Using dynamic maoUSDC address for ${targetNetworkName}: ${tokenAddress}`);
                        console.log(`[MAOUSDC LOCK] Address changed: ${addressChanged ? 'YES' : 'NO'} (original: ${sourceToken.address})`);
                    } else {
                        console.warn(`[MAOUSDC LOCK] Failed to get dynamic maoUSDC address for ${targetNetworkName}, using original: ${sourceToken.address}`);
                    }
                }
                
                // 最终确认使用的地址
                console.log(`[LOCK EXECUTION] Final token address being used: ${tokenAddress}`);
                console.log(`[LOCK EXECUTION] Parameters for lockTokens:`, {
                    networkName: currentNetwork,
                    sender: currentAddress,
                    receiver: receiver,
                    amount: value,
                    isNative: isNative,
                    tokenAddress: isNative ? 'Native (undefined)' : tokenAddress,
                    targetNetwork: targetNetworkName
                });
                
                // 执行锁定操作
                result = await contractService.lockTokens({
                    networkName: currentNetwork,
                    sender: currentAddress,
                    receiver: receiver,
                    amount: value,
                    isNative: isNative,
                    tokenAddress: isNative ? undefined : tokenAddress, // 使用可能更新后的地址
                    targetNetwork: targetNetworkName // 添加目标网络参数
                });
                
                // 记录执行结果
                console.log(`[LOCK EXECUTION] Lock transaction completed at ${new Date().toISOString()}`);
                if (result && result.transactionHash) {
                    console.log(`[LOCK EXECUTION] Transaction hash: ${result.transactionHash}`);
                }
            }
            console.log("Lock transaction result:", result);
            
            const txHash = result.transactionHash;
            dispatch({ type: 'SET_TX_HASH', payload: txHash });
            console.log("Transaction successful:", txHash);
            
            // If it's a burn operation, update burn progress bar status
            if (sourceToken.symbol.startsWith('mao')) {
                // Update burn completion status
                dispatch({ 
                    type: 'UPDATE_BURN_STEP', 
                    payload: { 
                        step: 'burnPending', 
                        data: { 
                            status: 'completed', 
                            txHash: txHash,
                            title: 'User wallet have been confirmation signature'
                        } 
                    } 
                });
                dispatch({ 
                    type: 'UPDATE_BURN_STEP', 
                    payload: { 
                        step: 'burnCompleted', 
                        data: { 
                            status: 'active', 
                            txHash: txHash,
                            title: `[${sourceToken.network}] ${sourceToken.symbol} is burning...`
                        } 
                    } 
                });
                dispatch({ type: 'SET_CURRENT_BURN_STEP', payload: 'burnCompleted' });
                
                // Update minting status
                setTimeout(() => {
                    dispatch({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'burnCompleted', 
                            data: { 
                                status: 'completed',
                                title: `[${sourceToken.network}] ${sourceToken.symbol} burned successfully`
                            } 
                        } 
                    });
                    dispatch({ 
                        type: 'UPDATE_BURN_STEP', 
                        payload: { 
                            step: 'mintPending', 
                            data: { 
                                status: 'active',
                                title: 'Cross-chain communication protocol is being processed'
                            } 
                        } 
                    });
                    dispatch({ type: 'SET_CURRENT_BURN_STEP', payload: 'mintPending' });
                }, 1000);
                
                // Trigger balance refresh after burn success
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('refreshBalance', {
                        detail: { operationType: 'burn', sourceToken: sourceToken }
                    }));
                }, 1000);
            }
            
            // Extract fee information, if available
            let fee = null;
            if (result.events && result.events.Locked) {
                fee = result.events.Locked.returnValues.fee;
            }
            
            // Prepare data to be sent to backend
            const transactionData: TransactionData = {
                fromAddress: currentAddress,
                toAddress: receiver,
                amount: value,
                sourceFromTxHash: txHash,
                fee: fee ? fee.toString() : null
            };
            
            // Print all data
            console.log("Data to be sent to backend:", transactionData);
            
            // Update lock completion status
            dispatch({
                type: 'UPDATE_BRIDGE_STEP',
                payload: {
                    step: 'lockPending',
                    data: { 
                        status: 'completed', 
                        txHash: txHash,
                        title: 'User wallet have been confirmation signature'
                    }
                }
            });
            dispatch({
                type: 'UPDATE_BRIDGE_STEP',
                payload: {
                    step: 'lockCompleted',
                    data: { 
                        status: 'completed', 
                        txHash: txHash,
                        title: `[${sourceToken.network}] ${sourceToken.symbol} lock successful !`
                    }
                }
            });
            dispatch({ type: 'SET_CURRENT_STEP', payload: 'lockCompleted' });
            
            // Update minting status
            setTimeout(() => {
                dispatch({
                    type: 'UPDATE_BRIDGE_STEP',
                    payload: {
                        step: 'mintPending',
                        data: { 
                            status: 'active',
                            title: 'Cross-chain communication protocol is being processed'
                        }
                    }
                });
                dispatch({ type: 'SET_CURRENT_STEP', payload: 'mintPending' });
            }, 1000);
            
            // Update status to lock successful, waiting for minting
            dispatch({ 
                type: 'SET_MINT_STATUS', 
                payload: {
                    success: true,
                    message: "Lock successful, waiting for minting confirmation...",
                    targetToTxHash: txHash
                }
            });
            
            // Trigger balance refresh after lock success
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('refreshBalance'));
            }, 1000);
            
            // Send data to backend
            await sendDataToBackend(transactionData);
            
            // Note: We don't set isProcessing to false at this point because we're still waiting for WebSocket messages
            // The WebSocket message handler will set isProcessing to false after receiving minting confirmation
            
        } catch (error) {
            console.error("Bridge transaction failed:", error);

            // Determine which step failed and update its status
            const failedStep = state.currentStep;
            if (failedStep) {
                dispatch({ 
                    type: 'UPDATE_BRIDGE_STEP', 
                    payload: { 
                        step: failedStep,
                        data: { status: 'failed' } 
                    } 
                });
            }
            
            let errorMessage = "Transaction failed";
            if (error instanceof Error) {
                errorMessage = error.message;
            } else {
                errorMessage = String(error);
            }
            
            // Provide more friendly error messages based on error type
             if (errorMessage.includes('User denied')) {
                 errorMessage = ERROR_MESSAGES.TRANSACTION_REJECTED;
             } else if (errorMessage.includes('insufficient funds')) {
                 errorMessage = ERROR_MESSAGES.INSUFFICIENT_BALANCE;
             } else if (errorMessage.includes('gas')) {
                 errorMessage = ERROR_MESSAGES.INSUFFICIENT_GAS;
             } else if (errorMessage.includes('Insufficient authorization') || errorMessage.includes('授权额度不足')) {
                 errorMessage = ERROR_MESSAGES.INSUFFICIENT_ALLOWANCE;
             } else if (errorMessage.includes('Insufficient token balance') || errorMessage.includes('代币余额不足')) {
                 errorMessage = ERROR_MESSAGES.INSUFFICIENT_BALANCE;
             } else if (errorMessage.includes('Network') && errorMessage.includes('not support') || 
                       errorMessage.includes('网络') && errorMessage.includes('不支持')) {
                 errorMessage = ERROR_MESSAGES.NETWORK_NOT_SUPPORTED;
             } else if (errorMessage.includes('Invalid amount') || errorMessage.includes('数量格式')) {
                 errorMessage = ERROR_MESSAGES.INVALID_AMOUNT;
             } else if (!errorMessage || errorMessage === 'Transaction failed') {
                 errorMessage = ERROR_MESSAGES.TRANSACTION_FAILED;
             }
            
            // Show error status
            dispatch({ 
                type: 'SET_MINT_STATUS', 
                payload: {
                    success: false,
                    message: errorMessage
                }
            });
            dispatch({ type: 'SET_SHOW_MINT_STATUS', payload: true });
            dispatch({ type: 'SET_PROCESSING', payload: false });
        }
    }
    
    // Cancel lock operation
    function cancelBridgeTransaction() {
        dispatch({ type: 'CLOSE_CONFIRM_DIALOG' });
    }
    
    // Send data to backend
    async function sendDataToBackend(data: TransactionData) {
        dispatch({ type: 'SET_SENDING_TO_BACKEND', payload: true });
        try {
            // Get current network information
            const currentNetwork = await web3Service.getCurrentNetwork();
            const networkConfig = NETWORK_CONFIGS[currentNetwork as keyof typeof NETWORK_CONFIGS];
            
            // Get target network information (from selected target token information)
            const targetNetwork = targetToken.network;
            const targetNetworkConfig = NETWORK_CONFIGS[targetNetwork as keyof typeof NETWORK_CONFIGS];
            
            // Get source and target chain token information (from selected token information)
            const sourceTokenName = `'${sourceToken.symbol}'`;
            console.log('Source token symbol:', sourceToken.symbol);
            
            const targetTokenName = `'${targetToken.symbol}'`;
            console.log('Target token symbol:', targetToken.symbol);
            
            // 检查是否是同名代币（不同网络上的相同代币）
            const isSameTokenType = isSameNamedToken(sourceToken, targetToken);
            console.log('Is same named token:', isSameTokenType);
            
            // Get source and target chain token contract addresses (from selected token information)
            let sourceContractAddress = sourceToken.address || "''";
            console.log('Source token contract address:', sourceContractAddress);
            
            // 如果是同名代币，尝试获取目标网络上对应的合约地址
            let targetContractAddress = targetToken.address || "''";
            if (isSameTokenType && !targetContractAddress) {
                // 尝试获取目标网络上的合约地址
                const targetAddress = await getTargetTokenAddress(sourceToken, targetNetwork);
                if (targetAddress) {
                    targetContractAddress = targetAddress;
                }
            }
            console.log('Target token contract address:', targetContractAddress);
            
            
            // 获取目标链ID
            const targetChainId = targetNetworkConfig ? parseInt(targetNetworkConfig.chainId, 16).toString() : '';
            
            // 获取目标合约地址
            let targetToCallContractAddress = "";
            if (targetChainId) {
                // 使用更新后的getTargetContractAddress方法，传入sourceNetwork参数
                targetToCallContractAddress = contractService.getTargetContractAddress(targetChainId, currentNetwork) || "";
                console.log(`Target contract address for chain ID ${targetChainId} from ${currentNetwork}:`, targetToCallContractAddress);
            }
            
            // Build new data format
            const requestData = {
                sourceChainId: networkConfig ? parseInt(networkConfig.chainId, 16).toString() : '', 
                sourceChain: `${currentNetwork}`, 
                sourceRpc: networkConfig ? `${networkConfig.rpcUrls[0]}` : "", 
                sourceFromAddress: data.fromAddress, 
                sourceFromTokenName: sourceTokenName, // Dynamically get source chain token symbol
                sourceFromTokenContractAddress: sourceContractAddress, // Get source chain contract address
                sourceFromAmount: data.amount, 
                sourceFromHandingFee: data.fee || "", 
                sourceFromRealAmount: data.amount, // Actual amount, may need to subtract fees
                sourceFromTxHash: data.sourceFromTxHash, 
                sourceFromTxStatus: "pending", 
                targetChainId: targetChainId, 
                targetChain: `${targetNetwork}`, 
                targetRpc: targetNetworkConfig ? `${targetNetworkConfig.rpcUrls[0]}` : "", 
                targetToAddress: data.toAddress, 
                targetToTokenName: targetTokenName, // Dynamically get target chain token symbol
                targetToTokenContractAddress: targetContractAddress, // Get target chain contract address
                targetToReceiveAmount: data.amount, // Receive amount, may be different from send amount
                targetToCallContractAddress: targetToCallContractAddress, // 使用新的getTargetContractAddress方法获取目标合约地址
                targetToGasStatus: "", 
                targetToTxHash: "", 
                targetToTxStatus: "pending", 
                crossBridgeStatus: "pending",
                walletAddress: state.walletAddress // Keep wallet address for identity verification
            };
            
            console.log("Sending data to backend:", requestData);
            const response = await axios.post(CURRENT_ENDPOINTS.CROSS_LOCK_INFO, requestData);
            // const response = await axios.post(CURRENT_ENDPOINTS.LOCK_INFO, requestData);
            console.log(response);
            if (response.status !== 200) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const responseData = response.data;
            dispatch({ type: 'SET_BACKEND_RESPONSE', payload: "Data successfully sent to backend, waiting for minting confirmation..." });
            console.log("Backend response:", responseData);
            
            // Set to processing state, waiting for WebSocket message
            dispatch({ type: 'SET_PROCESSING', payload: true });
            
            // Show temporary status message
            dispatch({ 
                type: 'SET_MINT_STATUS', 
                payload: {
                    success: undefined,
                    message: "Waiting for minting confirmation, please wait..."
                }
            });
            dispatch({ type: 'SET_SHOW_MINT_STATUS', payload: true });
            
            // No longer show alert, waiting for WebSocket message to update status
            // WebSocket message handling is in handleWebSocketMessage function
            
        } catch (error) {
            console.error("Failed to send data to backend:", error);
            dispatch({ type: 'SET_BACKEND_RESPONSE', payload: "Failed to send data to backend: " + (error instanceof Error ? error.message : String(error)) });
            
            // Display error status
            dispatch({ 
                type: 'SET_MINT_STATUS', 
                payload: {
                    success: false,
                    message: "Failed to send data to backend, but lock operation is complete",
                    targetToTxHash: data.sourceFromTxHash
                }
            });
            dispatch({ type: 'SET_SHOW_MINT_STATUS', payload: true });
            dispatch({ type: 'SET_PROCESSING', payload: false });
        } finally {
            dispatch({ type: 'SET_SENDING_TO_BACKEND', payload: false });
        }
    }
    
    return(
        <div className="flex flex-col w-full">
            <div className="w-full h-25 py-5 rounded-xl flex justify-between">
                {state.connected ? (
                    <div className="w-full h-full flex justify-center items-center">
                        <button 
                            className={`w-full h-full bg-black rounded-xl text-white font-bold text-xl hover:bg-gray-800 transition-colors ${
                                state.isProcessing || state.isCheckingAuthorization || state.isAuthorizing 
                                    ? 'opacity-70 cursor-not-allowed' 
                                    : 'cursor-pointer'
                            }`}
                            onClick={state.needsAuthorization ? handleAuthorization : handleBridgeClick}
                            disabled={state.isProcessing || state.isCheckingAuthorization || state.isAuthorizing}
                        >
                            {state.isProcessing 
                                ? "Processing..." 
                                : state.isCheckingAuthorization 
                                    ? "Checking..." 
                                    : state.isAuthorizing 
                                        ? "Authorizing..." 
                                        : state.needsAuthorization 
                                            ? "Authorize" 
                                            : "Bridge"
                            }
                        </button>
                    </div>
                ) : (
                    <div className="w-full h-full flex justify-center items-center">
                        <button 
                            className="w-full h-full bg-black rounded-xl text-white font-bold text-xl hover:bg-gray-800 transition-colors cursor-pointer" 
                            onClick={handleConnectClick}
                        >
                            Connect Wallet
                        </button>
                    </div>
                )}
            </div>
            
            {/* Mint Status Modal */}
            {state.showMintStatus && state.mintStatus && (
                <div className="fixed inset-0 flex items-center justify-center z-50">
                    {/* Blur Background */}
                    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={handleMintStatusClose}></div>
                    {/* Modal Content */}
                    <div className={`max-w-2xl w-full mx-4 p-6 rounded-xl shadow-xl z-50 ${state.mintStatus.success ? 'bg-white border-l-4 border-green-500' : 'bg-white border-l-4 border-yellow-500'}`}>
                        <div className="flex items-start">
                            <div className="flex-grow">
                                <p className={`text-lg font-medium ${state.mintStatus.success ? 'text-green-700' : 'text-yellow-700'}`}>
                                    {state.mintStatus.message}
                                </p>
                                
                                {/* Only show progress bars for bridge/burn operations, not for authorization */}
                                {!state.mintStatus.message.includes('Authorization') && (
                                    <div className="mt-6">
                                        {sourceToken.symbol.startsWith('mao') ? (
                                            <BurnProgressBar 
                                                steps={state.burnSteps} 
                                                currentStep={state.currentBurnStep}
                                                sourceNetwork={sourceToken.network}
                                                targetNetwork={targetToken.network}
                                            />
                                        ) : (
                                            <BridgeProgressBar 
                                                steps={state.bridgeSteps} 
                                                currentStep={state.currentStep}
                                                sourceNetwork={sourceToken.network}
                                                targetNetwork={targetToken.network}
                                            />
                                        )}
                                    </div>
                                )}
                                

                            </div>
                            <button 
                                onClick={handleMintStatusClose} 
                                className="ml-2 text-gray-400 hover:text-gray-600 text-xl font-medium"
                            >
                                ×
                            </button>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={handleMintStatusClose}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Confirmation Dialog */}
            {state.showConfirmDialog && state.transactionDetails && (
                <div className="fixed inset-0 flex items-center justify-center z-50">
                    {/* Frosted glass background */}
                    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={cancelBridgeTransaction}></div>
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl z-50">
                        <h2 className="text-xl font-bold mb-4">
                            {sourceToken.symbol.startsWith('mao') ? 'Confirm Burn Transaction' : 'Confirm Lock Transaction'}
                        </h2>
                        <div className="mb-4">
                            <p className="mb-2"><span className="font-semibold">Network:</span> {state.transactionDetails.currentNetwork}</p>
                            <p className="mb-2">
                                <span className="font-semibold">From Address:</span> 
                                <span className="font-mono text-sm" title={state.transactionDetails.currentAddress}>
                                    {formatAddress(state.transactionDetails.currentAddress)}
                                </span>
                            </p>
                            <p className="mb-2">
                                <span className="font-semibold">To Address:</span> 
                                <span className="font-mono text-sm" title={state.transactionDetails.receiver}>
                                    {formatAddress(state.transactionDetails.receiver)}
                                </span>
                            </p>
                            <p className="mb-2">
                                <span className="font-semibold">Amount:</span> {state.transactionDetails.value} {sourceToken.symbol}
                            </p>
                            <p className="mb-2">
                                <span className="font-semibold">Token:</span> {sourceToken.symbol}
                            </p>
                        </div>
                        <div className="flex justify-end space-x-3">
                            <button 
                                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 transition-colors"
                                onClick={cancelBridgeTransaction}
                            >
                                Cancel
                            </button>
                            <button 
                                className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 transition-colors"
                                onClick={confirmBridgeTransaction}
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}