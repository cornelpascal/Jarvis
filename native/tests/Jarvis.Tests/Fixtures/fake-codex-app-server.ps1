param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Remaining)
$request = [Console]::In.ReadLine() | ConvertFrom-Json
[Console]::Out.Write('{"method":"turn/delta","params":{"text":"fragmented"}}' + "`n" + '{"id":')
[Console]::Out.Flush()
Start-Sleep -Milliseconds 40
[Console]::Out.WriteLine(([string]$request.id) + ',"result":{"thread":{"id":"thread-test"}}}')
[Console]::Out.Flush()
