on run {daemon_file, agent_file, user}

  set sh1 to "echo " & quoted form of daemon_file & " > /Library/LaunchDaemons/com.camellia_service.plist && chown root:wheel /Library/LaunchDaemons/com.camellia_service.plist;"

  set sh2 to "echo " & quoted form of agent_file & " > /Library/LaunchAgents/com.camellia_server.plist && chown root:wheel /Library/LaunchAgents/com.camellia_server.plist;"

  set sh3 to "cp -rf /Users/" & user & "/Library/Preferences/com.camellia/Camellia.toml /var/root/Library/Preferences/com.camellia/;"

  set sh4 to "cp -rf /Users/" & user & "/Library/Preferences/com.camellia/Camellia2.toml /var/root/Library/Preferences/com.camellia/;"

  set sh5 to "launchctl load -w /Library/LaunchDaemons/com.camellia_service.plist;"

  set sh to sh1 & sh2 & sh3 & sh4 & sh5

  do shell script sh with prompt "Camellia wants to install daemon and agent" with administrator privileges
end run
