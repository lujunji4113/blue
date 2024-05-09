su ${_REMOTE_USER} -c "curl -fsSL https://deno.land/install.sh | sh"

echo "export DENO_INSTALL=\"\$HOME/.deno\"" >> ${_REMOTE_USER_HOME}/.bashrc
echo "export PATH=\"\$DENO_INSTALL/bin:\$PATH\"" >> ${_REMOTE_USER_HOME}/.bashrc

source ${_REMOTE_USER_HOME}/.bashrc