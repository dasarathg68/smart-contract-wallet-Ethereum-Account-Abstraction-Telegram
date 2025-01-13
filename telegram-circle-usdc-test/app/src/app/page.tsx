"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { W3SSdk, ChallengeResult } from "@circle-fin/w3s-pw-web-sdk";

type Step = "initial" | "setup-pin" | "create-wallet" | "manage-wallet";

// Initialize the SDK

interface Wallet {
  id: string;
  state: string;
  walletSetId: string;
  custodyType: string;
  userId: string;
  address: string;
  blockchain: string;
  accountType: string;
  updateDate: string;
  createDate: string;
}

export default function Home() {
  const sdk = new W3SSdk();

  const [step, setStep] = useState<Step>("initial");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userToken, setUserToken] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [challengeId, setChallengeId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [encryptionKey, setEncryptionKey] = useState<string>("");
  const [wallets, setWallets] = useState<Wallet[]>([]);

  // Load userId from localStorage on component mount
  useEffect(() => {
    const storedUserId = localStorage.getItem("circle_user_id");
    if (storedUserId) {
      setUserId(storedUserId);
      // If we have a userId, try to get a token
      getExistingUserToken(storedUserId);
    }
    sdk.setAppSettings({ appId: "da208e3c-d79c-57ca-8192-cf758156c7f1" });
  }, []);

  // Update SDK authentication when userToken or encryptionKey changes
  useEffect(() => {
    if (userToken && encryptionKey) {
      console.log(sdk);
      sdk.setAppSettings({ appId: "da208e3c-d79c-57ca-8192-cf758156c7f1" });

      sdk.setAuthentication({
        userToken,
        encryptionKey,
      });

      // Check if PIN is already set up
      checkPinStatus();
    }
  }, [userToken, encryptionKey]);

  // Check PIN status
  const checkPinStatus = async () => {
    try {
      if (!userId) return;
      console.log(userId);
      const response = await axios.get(`/api/users/status?userId=${userId}`);
      console.log(response.data);
      if (response.data.hasPinEnabled) {
        console.log("PIN is already enabled, skipping PIN setup");
        setStep("manage-wallet");
      }
    } catch (err: any) {
      console.error("Error checking PIN status:", err);
      // Don't show error to user, just proceed with PIN setup
    }
  };

  // Get token for existing user
  const getExistingUserToken = async (existingUserId: string) => {
    try {
      setLoading(true);
      const response = await axios.post("/api/users/token", {
        userId: existingUserId,
      });

      setUserToken(response.data.userToken);
      setEncryptionKey(response.data.encryptionKey);

      // Check if PIN is already set up
      const statusResponse = await axios.get(
        `/api/users/status?userId=${existingUserId}`
      );
      console.log(statusResponse.data);
      if (statusResponse.data.hasPinEnabled) {
        console.log("PIN is already enabled, skipping PIN setup");
        setStep("manage-wallet");
      } else {
        setStep("setup-pin");
      }
    } catch (err: any) {
      console.error("Error getting existing user token:", err);
      setError(err.response?.data?.error || "Failed to get user token");
      localStorage.removeItem("circle_user_id");
      setUserId("");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    console.log(step);
    if (step === "setup-pin") {
      checkPinStatus();
    }
  }, [step]);
  // Create user and get token
  const createUser = async () => {
    try {
      setLoading(true);
      const newUserId = `user_${uuidv4()}`;

      const response = await axios.post("/api/users/create", {
        userId: newUserId,
      });

      localStorage.setItem("circle_user_id", newUserId);
      setUserId(newUserId);
      setUserToken(response.data.userToken);
      setEncryptionKey(response.data.encryptionKey);

      // Check if PIN is already set up (unlikely for new user, but good practice)
      const statusResponse = await axios.get(
        `/api/users/status?userId=${newUserId}`
      );
      if (statusResponse.data.hasPinEnabled) {
        console.log("PIN is already enabled, skipping PIN setup");
        setStep("manage-wallet");
      } else {
        setStep("setup-pin");
      }
    } catch (err: any) {
      console.error("User creation error:", err);
      setError(err.response?.data?.error || "Failed to create user");
      localStorage.removeItem("circle_user_id");
      setUserId("");
      setUserToken("");
    } finally {
      setLoading(false);
    }
  };

  // Create PIN challenge
  const createPinChallenge = async () => {
    try {
      if (!userToken) {
        throw new Error("No user token available. Please create a user first.");
      }
      setLoading(true);
      const response = await axios.post("/api/users/pin/challenge", {
        userToken,
      });

      const newChallengeId = response.data.challengeId;
      setChallengeId(newChallengeId);

      // Execute the challenge using the SDK
      console.log(sdk);
      await new Promise<ChallengeResult>((resolve, reject) => {
        const executeChallenge = () => {
          sdk.execute(newChallengeId, (error, result) => {
            if (error) {
              console.error(`Error executing challenge: ${error.message}`);
              reject(error);
              return;
            }

            if (!result) {
              reject(new Error("No result from challenge execution"));
              return;
            }

            console.log(`Challenge: ${result.type}`);
            console.log(`status: ${result.status}`);

            if (result.status === "COMPLETE") {
              setStep("create-wallet");
              resolve(result);
            } else if (result.status === "IN_PROGRESS") {
              // If still in progress, wait 2 seconds and try again
              setTimeout(executeChallenge, 2000);
            } else {
              reject(
                new Error(`Challenge failed with status: ${result.status}`)
              );
            }
          });
        };

        // Start the polling
        executeChallenge();
      });
    } catch (err: any) {
      console.error("PIN challenge error:", err);
      setError(
        err.response?.data?.error ||
          err.message ||
          "Failed to create PIN challenge"
      );
    } finally {
      setLoading(false);
    }
  };

  // Create wallet
  const createWallet = async () => {
    try {
      if (!userToken) {
        throw new Error(
          "No user token available. Please set up your PIN first."
        );
      }
      setLoading(true);
      const response = await axios.post("/api/wallet/create", {
        userToken,
      });

      const newChallengeId = response.data.challengeId;

      // Execute the wallet creation challenge
      await new Promise<ChallengeResult>((resolve, reject) => {
        const executeChallenge = () => {
          sdk.execute(newChallengeId, (error, result) => {
            if (error) {
              console.error(`Error executing challenge: ${error.message}`);
              reject(error);
              return;
            }

            if (!result) {
              reject(new Error("No result from challenge execution"));
              return;
            }

            console.log(`Challenge: ${result.type}`);
            console.log(`status: ${result.status}`);
            console.log(result);

            if (result.status === "COMPLETE") {
              setStep("manage-wallet");
              resolve(result);
            } else if (result.status === "IN_PROGRESS") {
              // If still in progress, wait 2 seconds and try again
              setTimeout(executeChallenge, 2000);
            } else {
              reject(
                new Error(`Challenge failed with status: ${result.status}`)
              );
            }
          });
        };

        // Start the polling
        executeChallenge();
      });
      console.log(response);
      console.log("Wallet created with ID:", response.data.walletId);
      setStep("manage-wallet");
    } catch (err: any) {
      console.error("Wallet creation error:", err);
      setError(
        err.response?.data?.error || err.message || "Failed to create wallet"
      );
    } finally {
      setLoading(false);
    }
  };

  const clearUser = () => {
    localStorage.removeItem("circle_user_id");
    setUserId("");
    setUserToken("");
    setEncryptionKey("");
    setStep("initial");
    setError(null);
  };

  // Load wallets when entering manage-wallet step
  useEffect(() => {
    if (step === "manage-wallet" && userId) {
      loadWallets();
    }
  }, [step, userId]);

  const loadWallets = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/wallet/list?userId=${userId}`);
      setWallets(response.data.wallets);
    } catch (err: any) {
      console.error("Error loading wallets:", err);
      setError(err.response?.data?.error || "Failed to load wallets");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Circle Wallet</h1>
            {userId && (
              <button
                onClick={clearUser}
                className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
              >
                Clear User
              </button>
            )}
          </div>

          {step === "initial" && (
            <div className="space-y-6">
              {userId ? (
                <p className="text-gray-600">
                  Welcome back! User ID: {userId.slice(0, 8)}...
                </p>
              ) : (
                <p className="text-gray-600">
                  Start by creating a new user account
                </p>
              )}
              <button
                onClick={
                  userId ? () => getExistingUserToken(userId) : createUser
                }
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading
                  ? "Processing..."
                  : userId
                  ? "Continue with Existing Account"
                  : "Create User Account"}
              </button>
            </div>
          )}

          {step === "setup-pin" && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">
                Set up PIN
              </h2>
              <button
                onClick={createPinChallenge}
                disabled={loading || !userToken}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Challenge
              </button>
            </div>
          )}

          {step === "create-wallet" && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">
                Create Wallet
              </h2>
              <p className="text-gray-600">
                Create your Ethereum wallet on Sepolia testnet
              </p>
              <button
                onClick={createWallet}
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating..." : "Create Wallet"}
              </button>
            </div>
          )}

          {step === "manage-wallet" && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">
                Your Wallets
              </h2>
              {loading ? (
                <div className="text-center py-8">
                  <p className="text-gray-600">Loading wallets...</p>
                </div>
              ) : wallets.length > 0 ? (
                <div className="space-y-4">
                  {wallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className="p-6 border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="space-y-2">
                        <p className="font-medium text-gray-900">
                          Wallet ID: {wallet.id}
                        </p>
                        <p className="text-sm text-gray-600 break-all">
                          Address: {wallet.address}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            {wallet.blockchain}
                          </span>
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                            {wallet.accountType}
                          </span>
                          <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
                            {wallet.state}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={loadWallets}
                    disabled={loading}
                    className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Refresh Wallets
                  </button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-4">No wallets found</p>
                  <button
                    onClick={() => setStep("create-wallet")}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                  >
                    Create New Wallet
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
