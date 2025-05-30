# Optimism AI Agent contracts

WIP

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Test + Gas report

```shell
$ forge test --gas-report
```

### Running locally

Set up .env file with:

```
RPC_URL="http://127.0.0.1:8545"
ADMIN_PRIV_KEY=""
ADMIN_ADDRESS=""
AGENT_PRIV_KEY=""
AGENT_ADDRESS=""

FAKE_GOVERNOR_ADDRESS=""
CAST_VOTE_ADDRESS=""
```

Run Anvil:

```
anvil --chain-id 31337
```

Add keys to .env file. Reload .env after every save:

```
source .env
```

Deploy FakeGovernor:

```
forge create \
  src/FakeGovernor.sol:FakeGovernor \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIV_KEY \
  --broadcast
```

Deploy CastVote:

```
forge create \
  src/CastVote.sol:CastVote \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIV_KEY \
  --broadcast \
  --constructor-args $ADMIN_ADDRESS
```

Assign agent role:

```
cast send \
  $CAST_VOTE_ADDRESS \
  "grantAgentRole(address)" \
  $AGENT_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIV_KEY
```

Cast vote:

```
cast send                                 \
  $CAST_VOTE_ADDRESS                       \
  "castVote(address,uint256,uint8,string,bytes,bytes32,bytes32)" \
  $FAKE_GOVERNOR_ADDRESS                   \
  1                                        \
  1                                        \
  '"Test"'                                 \
  0x                                       \
  0x8979534e68409ec95913c5d78564f421c8accb82037cd6bcc8838a20760ce13f \
  0x2222222222222222222222222222222222222222222222222222222222222222 \
  --rpc-url $RPC_URL                       \
  --private-key $AGENT_PRIV_KEY
```

Check vote:

```
cast call \
  $CAST_VOTE_ADDRESS \
  "votes(uint256)(address,uint256,uint8,bytes32,bytes32)" \
  1 \
  --rpc-url $RPC_URL
```
