import { Web3 } from "web3";
import BN from "bn.js";
import kleur from "kleur";
import promptSync from "prompt-sync";
import readline from "readline";
import type { Web3Account } from "web3-eth-accounts";
import { abi } from "./abi";
import { fetch } from "bun";

interface AppConfig {
  rpc: string;
  privateKeys: string[];
  wethAddress: string;
  mode: "auto" | "manual";
  totalTx: number;
  delayMinutes: number;
  gasPriceMultiplier: number;
  runHour?: number;
  runMinute?: number;
  amounts: string[];
}

function validateMode(mode: string): "auto" | "manual" {
  if (mode !== "auto" && mode !== "manual") {
    throw new Error('Mode must be "auto" or "manual"');
  }
  return mode as "auto" | "manual";
}

function validatePositiveNumber(input: string, fieldName: string): number {
  const value = parseFloat(input);
  if (isNaN(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return value;
}

function validateHour(input: string): number {
  const hour = parseInt(input);
  if (isNaN(hour) || hour < 0 || hour > 23) {
    throw new Error("Hour must be between 0-23");
  }
  return hour;
}

function validateMinute(input: string): number {
  const minute = parseInt(input);
  if (isNaN(minute) || minute < 0 || minute > 59) {
    throw new Error("Minute must be between 0-59");
  }
  return minute;
}

function loadConfiguration(privateKeys: string[]): AppConfig {
  const prompt = promptSync();

  const mode = validateMode(prompt("Enter mode (auto/manual): ").toLowerCase());
  const totalTx = validatePositiveNumber(
    prompt("Enter total transactions per account: "),
    "Transaction count"
  );
  const delayMinutes = validatePositiveNumber(
    prompt("Enter delay between transactions (minutes): "),
    "Transaction delay"
  );
  const gasPriceMultiplier = validatePositiveNumber(
    prompt("Enter gas price multiplier (e.g., 1.2 for 120%): "),
    "Gas price multiplier"
  );

  const amounts = privateKeys.map((_, index) =>
    prompt(`Enter total ether amount for account ${index + 1}: `)
  );

  const config: AppConfig = {
    rpc: "https://rpc.api.lisk.com",
    privateKeys,
    wethAddress: "0x4200000000000000000000000000000000000006",
    mode,
    totalTx,
    delayMinutes,
    gasPriceMultiplier,
    amounts,
  };

  if (mode === "auto") {
    config.runHour = validateHour(prompt("Enter hour to run bot (0-23): "));
    config.runMinute = validateMinute(
      prompt("Enter minute to run bot (0-59): ")
    );
  }

  return config;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelayUntilNextRun(hour: number, minute: number): number {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setHours(hour, minute, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun.getTime() - now.getTime();
}

function countdown(ms: number): void {
  const end = Date.now() + ms;
  const interval = setInterval(() => {
    const now = Date.now();
    const remaining = end - now;
    if (remaining <= 0) {
      clearInterval(interval);
      return;
    }

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 1);
    process.stdout.write(
      `Time remaining until next run: ${kleur
        .yellow()
        .bold(`${hours}h ${minutes}m ${seconds}s`)}`
    );
  }, 1000);
}

async function getGasPrice(
  web3: Web3,
  gasPriceMultiplier: number
): Promise<string> {
  const gasPrice = await web3.eth.getGasPrice();
  const adjustedGasPrice = new BN(gasPrice.toString())
    .muln(gasPriceMultiplier)
    .toString();
  console.log(
    kleur.blue("Gas price in GWEI: "),
    kleur.green(Web3.utils.fromWei(adjustedGasPrice, "gwei"))
  );
  return adjustedGasPrice;
}

async function wrap(
  web3: Web3,
  wethContract: any,
  account: Web3Account,
  amount: BN,
  i: number
): Promise<void> {
  const gasPrice = await getGasPrice(web3, 1.2);

  const wrapGasEstimate = await wethContract.methods.deposit().estimateGas({
    from: account.address,
    value: amount.toString(),
  });

  const wrapReceipt = await wethContract.methods.deposit().send({
    from: account.address,
    value: amount.toString(),
    gas: wrapGasEstimate.toString(),
    gasPrice: gasPrice.toString(),
  });

  console.log(
    kleur.green(
      `Wrap ${i + 1}: Transaction Hash: https://blockscout.lisk.com/tx/${
        wrapReceipt.transactionHash
      }`
    )
  );
}

async function unwrap(
  web3: Web3,
  wethContract: any,
  account: Web3Account,
  i: number
): Promise<void> {
  const wethBalance = new BN(
    await wethContract.methods.balanceOf(account.address).call()
  );
  const gasPrice = await getGasPrice(web3, 1.2);

  const unwrapGasEstimate = await wethContract.methods
    .withdraw(wethBalance.toString())
    .estimateGas({
      from: account.address,
    });

  const unwrapReceipt = await wethContract.methods
    .withdraw(wethBalance.toString())
    .send({
      from: account.address,
      gas: unwrapGasEstimate.toString(),
      gasPrice: gasPrice.toString(),
    });

  console.log(
    kleur.green(
      `Unwrap ${i + 1}: Transaction Hash: https://blockscout.lisk.com/tx/${
        unwrapReceipt.transactionHash
      }`
    )
  );
}

async function retryTransaction(
  transactionFunction: Function,
  args: any[]
): Promise<void> {
  while (true) {
    try {
      await transactionFunction(...args);
      return;
    } catch (error: any) {
      const errorMessage =
        error.cause?.message || error.message || "Unknown error";
      console.error(
        kleur.red(`Error in transaction: ${errorMessage}. Retrying...`)
      );
      await delay(1000);
    }
  }
}

async function runTransactions(
  web3: Web3,
  wethContract: any,
  accounts: Web3Account[],
  config: AppConfig
): Promise<void> {
  for (let i = 0; i < config.totalTx; i++) {
    for (let accIndex = 0; accIndex < accounts.length; accIndex++) {
      const account = accounts[accIndex];
      const amountPerTx = new BN(
        web3.utils.toWei(config.amounts[accIndex], "ether")
      );

      console.log(
        kleur.blue(`\nTransaction: ${i + 1} for account ${account.address}`)
      );

      while (true) {
        try {
          await delay(1000);
          const wethBalance = new BN(
            await wethContract.methods.balanceOf(account.address).call()
          );

          if (wethBalance.gt(new BN(0))) {
            await retryTransaction(unwrap, [web3, wethContract, account, i]);
          } else {
            await retryTransaction(wrap, [
              web3,
              wethContract,
              account,
              amountPerTx,
              i,
            ]);
          }

          console.log(kleur.green("Transaction Completed!\n"));
          break;
        } catch (error: any) {
          console.error(
            kleur.red(
              `Final error in transaction ${i + 1} for account ${
                account.address
              }: ${error.message}`
            )
          );
          await delay(1000);
        }
      }

      if (i !== config.totalTx - 1 || accIndex !== accounts.length - 1) {
        const delayMs = config.delayMinutes * 60 * 1000;
        await delay(delayMs);
      }
    }
  }

  console.log(kleur.blue(`\nAll transactions completed.`));
}

async function wrapUnwrapLoop(config: AppConfig): Promise<void> {
  const privateKeys = config.privateKeys;
  const web3 = new Web3(config.rpc);

  const accounts = privateKeys.map((pk) => {
    const account = web3.eth.accounts.privateKeyToAccount("0x" + pk);
    web3.eth.accounts.wallet.add(account);
    return account;
  });

  const wethContract = new web3.eth.Contract(abi, config.wethAddress);

  if (config.mode === "auto") {
    while (true) {
      const delayUntilNextRun = calculateDelayUntilNextRun(
        config.runHour!,
        config.runMinute!
      );
      console.log(
        kleur.blue(
          `\nWaiting until ${config.runHour}:${config.runMinute} to start transactions...`
        )
      );

      countdown(delayUntilNextRun);
      await delay(delayUntilNextRun);

      await runTransactions(web3, wethContract, accounts, config);
      await dailyCheckin(config);
      
      console.log(kleur.blue(`\nAll transactions completed for today.`));
    }
  } else if (config.mode === "manual") {
    await runTransactions(web3, wethContract, accounts, config);
    await dailyCheckin(config);
  } else {
    console.error(
      kleur.red(
        'Invalid mode selected. Please choose either "auto" or "manual".'
      )
    );
  }
}

async function dailyCheckin(config: AppConfig) {
  const privateKeys = config.privateKeys;
  const web3 = new Web3(config.rpc);

  const accounts = privateKeys.map((pk) => {
    const account = web3.eth.accounts.privateKeyToAccount("0x" + pk);
    web3.eth.accounts.wallet.add(account);
    return account;
  });
  try {
    const results = await Promise.all(
      accounts.map(async (account) => {
        try {
          const response = await fetch("https://portal-api.lisk.com/graphql", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query:
                "\n    mutation UpdateAirdropTaskStatus($input: UpdateTaskStatusInputData!) {\n  userdrop {\n    updateTaskStatus(input: $input) {\n      success\n      progress {\n        isCompleted\n        completedAt\n      }\n    }\n  }\n}\n    ",
              variables: {
                input: {
                  address: account.address,
                  taskID: 1,
                },
              },
            }),
          });

          if (!response.ok) {
            throw new Error(
              `HTTP error for ${account.address}: ${response.status}`
            );
          }

          console.log(
            kleur.green(`Check-in successful for ${account.address}`)
          );
          return response;
        } catch (accountError) {
          console.error(
            kleur.yellow(`Check-in failed for ${account.address}: `),
            accountError
          );
          return null;
        }
      })
    );

    const successfulResults = results.filter((result) => result !== null);

    console.log(
      kleur.green(
        `Daily check-in completed for ${successfulResults.length} accounts`
      )
    );
  } catch (error) {
    console.error(kleur.red("Fatal error in daily check-in: "), error);
  }
}

async function main() {
  try {
    if (!Bun.env.PRIVATE_KEYS) {
      throw new Error("Private keys must be configured in .env file");
    }

    const privateKeys = Bun.env.PRIVATE_KEYS.split(",");
    const config = loadConfiguration(privateKeys);

    await wrapUnwrapLoop(config);

  } catch (error) {
    console.error(kleur.red("Fatal error: "), error);
  }
}

main();
