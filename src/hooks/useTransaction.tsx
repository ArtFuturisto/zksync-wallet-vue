import { useState, useCallback } from 'react';
import { ContractTransaction, ethers } from 'ethers';
import {
  closestPackableTransactionAmount,
  closestPackableTransactionFee,
  getDefaultProvider,
} from 'zksync';

import { useRootData } from '../hooks/useRootData';

import { IEthBalance } from '../types/Common';
import { PriorityOperationReceipt } from 'zksync/build/types';

import { ADDRESS_VALIDATION } from '../constants/regExs';
import { DEFAULT_ERROR } from '../constants/errors';
import { ZK_FEE_MULTIPLIER } from '../constants/magicNumbers';

const TOKEN = 'ETH';

export const useTransaction = () => {
  const {
    hintModal,
    provider,
    setError,
    setHintModal,
    setVerifyToken,
    setZkBalances,
    tokens,
    walletAddress,
    zkWallet,
  } = useRootData(
    ({
      hintModal,
      provider,
      setError,
      setHintModal,
      setVerifyToken,
      setZkBalances,
      tokens,
      walletAddress,
      zkWallet,
    }) => ({
      hintModal: hintModal.get(),
      provider: provider.get(),
      setError,
      setHintModal,
      setVerifyToken,
      setZkBalances,
      tokens: tokens.get(),
      walletAddress: walletAddress.get(),
      zkWallet: zkWallet.get(),
    }),
  );

  const [addressValue, setAddressValue] = useState<string>(
    walletAddress[1] ? walletAddress[1] : '',
  );
  const [amountValue, setAmountValue] = useState<any>(0);
  const [hash, setHash] = useState<ContractTransaction | string | undefined>();
  const [isExecuted, setExecuted] = useState<boolean>(false);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [symbol, setSymbol] = useState<string>('');

  const history = useCallback(
    (
      amount: number,
      hash: string | undefined,
      to: string,
      type: string,
      token: string,
    ) => {
      try {
        const history = JSON.parse(
          localStorage.getItem(`history${zkWallet?.address()}`) || '[]',
        );
        const newHistory = JSON.stringify([
          { amount, date: new Date(), hash, to, type, token },
          ...history,
        ]);
        localStorage.setItem(`history${zkWallet?.address()}`, newHistory);
      } catch (err) {
        err.name && err.message
          ? setError(`${err.name}: ${err.message}`)
          : setError(DEFAULT_ERROR);
      }
    },
    [setError, zkWallet],
  );

  const transactions = useCallback(
    async (receipt: PriorityOperationReceipt) => {
      try {
        if (receipt && zkWallet) {
          setLoading(false);
          const zkBalance = (await zkWallet.getAccountState()).committed
            .balances;
          const zkBalancePromises = Object.keys(zkBalance).map(async key => {
            return {
              address: tokens[key].address,
              balance: +zkBalance[key] / Math.pow(10, 18),
              symbol: tokens[key].symbol,
            };
          });

          Promise.all(zkBalancePromises)
            .then(res => {
              setZkBalances(res as IEthBalance[]);
            })
            .catch(err => {
              err.name && err.message
                ? setError(`${err.name}: ${err.message}`)
                : setError(DEFAULT_ERROR);
            });
          setAmountValue(0);
        }
        if (receipt.executed) {
          setExecuted(true);
        }
      } catch (err) {
        err.name && err.message
          ? setError(`${err.name}: ${err.message}`)
          : setError(DEFAULT_ERROR);
      }
    },
    [
      setAmountValue,
      setError,
      setExecuted,
      setLoading,
      setZkBalances,
      tokens,
      zkWallet,
    ],
  );

  const deposit = useCallback(
    async (token = TOKEN) => {
      if (zkWallet) {
        try {
          setLoading(true);
          const executeDeposit = async fee => {
            const depositPriorityOperation = await zkWallet.depositToSyncFromEthereum(
              {
                depositTo: zkWallet.address(),
                token: token,
                amount: ethers.utils.bigNumberify(
                  amountValue
                    ? closestPackableTransactionAmount(amountValue?.toString())
                    : '0',
                ),
                maxFeeInETHToken: ethers.utils.bigNumberify(
                  closestPackableTransactionFee(
                    (2 * ZK_FEE_MULTIPLIER * fee).toString(),
                  ),
                ),
              },
            );
            const hash = depositPriorityOperation.ethTx;
            history(
              amountValue / Math.pow(10, 18) || 0,
              hash.hash,
              zkWallet.address(),
              'deposit',
              symbol,
            );
            setHash(hash);
            await depositPriorityOperation.awaitEthereumTxCommit().then(() => {
              setHintModal('Block has been mined!');
            });
            const receipt = await depositPriorityOperation.awaitReceipt();
            transactions(receipt);
            setLoading(false);
            const verifyReceipt = await depositPriorityOperation.awaitVerifyReceipt();
            setVerifyToken(!!verifyReceipt);
          };
          ethers
            .getDefaultProvider()
            .getGasPrice()
            .then(res => res.toString())
            .then(data => executeDeposit(data));
        } catch (err) {
          err.name && err.message
            ? setError(`${err.name}: ${err.message}`)
            : setError(DEFAULT_ERROR);
        }
      }
    },
    [
      amountValue,
      hintModal,
      history,
      setError,
      setHash,
      setHintModal,
      setLoading,
      setVerifyToken,
      transactions,
      zkWallet,
    ],
  );

  const transfer = useCallback(
    async (token = TOKEN) => {
      try {
        if (ADDRESS_VALIDATION['eth'].test(addressValue) && zkWallet) {
          setLoading(true);
          const transferTransaction = await zkWallet.syncTransfer({
            to: addressValue,
            token: token,
            amount: ethers.utils.bigNumberify(
              amountValue
                ? closestPackableTransactionAmount(amountValue?.toString())
                : '0',
            ),
            fee: ethers.utils.bigNumberify(
              closestPackableTransactionFee(
                Math.floor(amountValue * 0.001).toString(),
              ),
            ),
          });
          const hash = transferTransaction.txHash;
          history(
            amountValue / Math.pow(10, 18) || 0,
            hash,
            addressValue,
            'transfer',
            symbol,
          );
          setHash(hash);
          const receipt = await transferTransaction.awaitReceipt();
          transactions(receipt);
          const verifyReceipt = await transferTransaction.awaitVerifyReceipt();
          setVerifyToken(!!verifyReceipt);
        } else {
          setError(
            `Address: "${addressValue}" doesn't match ethereum address format`,
          );
        }
      } catch (err) {
        err.name && err.message
          ? setError(`${err.name}: ${err.message}`)
          : setError(DEFAULT_ERROR);
        setLoading(false);
      }
    },
    [
      addressValue,
      amountValue,
      history,
      setError,
      setVerifyToken,
      transactions,
      zkWallet,
    ],
  );

  const withdraw = useCallback(
    async (token = TOKEN) => {
      try {
        if (ADDRESS_VALIDATION['eth'].test(addressValue) && zkWallet) {
          setLoading(true);
          const withdrawTransaction = await zkWallet.withdrawFromSyncToEthereum(
            {
              ethAddress: addressValue,
              token: token,
              amount: ethers.utils.bigNumberify(
                amountValue
                  ? closestPackableTransactionAmount(amountValue?.toString())
                  : '0',
              ),
              fee: ethers.utils.bigNumberify(
                closestPackableTransactionFee(
                  Math.floor(amountValue * 0.001).toString(),
                ),
              ),
            },
          );
          const hash = withdrawTransaction.txHash;
          history(
            amountValue / Math.pow(10, 18) || 0,
            hash,
            addressValue,
            'withdraw',
            symbol,
          );
          setHash(hash);
          const receipt = await withdrawTransaction.awaitReceipt();
          transactions(receipt);
          const verifyReceipt = await withdrawTransaction.awaitVerifyReceipt();
          setVerifyToken(!!verifyReceipt);
        } else {
          setError(
            `Address: "${addressValue}" doesn't match ethereum address format`,
          );
        }
      } catch (err) {
        err.name && err.message
          ? setError(`${err.name}: ${err.message}`)
          : setError(DEFAULT_ERROR);
        setLoading(false);
      }
    },
    [
      addressValue,
      amountValue,
      history,
      setError,
      setHash,
      setLoading,
      setVerifyToken,
      transactions,
      zkWallet,
    ],
  );

  return {
    addressValue,
    amountValue,
    deposit,
    hash,
    isExecuted,
    isLoading,
    setAddressValue,
    setAmountValue,
    setExecuted,
    setHash,
    setLoading,
    setSymbol,
    transfer,
    withdraw,
  };
};