#!/bin/bash

REPO_URL="https://github.com/Mnuralim/lisk-bot.git"

setup_timezone() {
  echo "Setting timezone to Asia/Jakarta..."
  sudo timedatectl set-timezone Asia/Jakarta
  echo "Timezone set to $(timedatectl | grep 'Time zone')"
}

check_git() {
  echo "Checking if Git is installed..."
  if ! command -v git &>/dev/null; then
    echo "Git is not installed. Installing Git..."
    sudo apt update && sudo apt install -y git
    echo "Git installed successfully."
  else
    echo "Git is already installed."
  fi
}

check_curl() {
  echo "Checking if Curl is installed..."
  if ! command -v curl &>/dev/null; then
    echo "Curl is not installed. Installing Curl..."
    sudo apt update && sudo apt install -y curl
    echo "Curl installed successfully."
  else
    echo "Curl is already installed."
  fi
}

check_and_install_bun() {
  echo "Checking if Bun is installed..."
  if ! command -v bun &>/dev/null; then
    echo "Bun is not installed. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    echo 'export BUN_INSTALL="$HOME/.bun"' >>~/.bashrc
    echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >>~/.bashrc
    echo "Bun installed successfully. Please restart your terminal or run 'source ~/.bashrc' if this is the first time installing Bun."
  else
    echo "Bun is already installed."
  fi
}

check_and_install_screen() {
  echo "Checking if Screen is installed..."
  if ! command -v screen &>/dev/null; then
    echo "Screen is not installed. Installing Screen..."
    sudo apt update && sudo apt install -y screen
    echo "Screen installed successfully."
  else
    echo "Screen is already installed."
  fi
}

setup_env_file() {
  echo "Setup .env file..."

  if [ -f .env ]; then
    echo ".env file already exists. Do you want to overwrite it? (y/n)"
    read -r overwrite
    if [[ $overwrite != "y" ]]; then
      echo "Skipping .env setup."
      return
    fi
  fi

  echo -n "Enter your private keys (comma-separated, e.g., pk1,pk2,...): "
  read -r private_keys

  echo "PRIVATE_KEYS=$private_keys" >.env
  echo ".env file has been created/updated."
}

install_dependencies() {
  echo "Installing dependencies with Bun..."
  bun install
}

run_project_in_screen() {
  echo "Checking if a screen session 'lisk-bot' is already running..."
  if screen -list | grep -q "lisk-bot"; then
    echo "Screen session 'lisk-bot' is already running. Attaching to the session..."
    screen -r lisk-bot
  else
    echo "Starting the project in a new screen session..."
    exec screen -S lisk-bot bash -c "bun run start"
  fi
}

setup_timezone

check_git

check_curl

check_and_install_bun

check_and_install_screen

repo_name=$(basename "$REPO_URL" .git)

if git clone "$REPO_URL"; then
  echo "Repository cloned successfully."
else
  echo "Failed to clone the repository. Exiting."
  exit 1
fi

cd "$repo_name" || {
  echo "Failed to navigate to project folder. Exiting."
  exit 1
}

setup_env_file

install_dependencies

run_project_in_screen
