//go:build js && wasm

// This file is compiled into D2's netpolicy package for the VS Code Node host.
package netpolicy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"strconv"
	"syscall/js"
)

var nodeHTTP = js.Global().Get("d2HTTP")

// NewHTTPClient preserves the caller's timeout and redirect policy. The JS
// target has no TCP or DNS, so only the last hop to a socket goes through Node.
func NewHTTPClient(base *http.Client, policy Policy) (*http.Client, error) {
	if base == nil {
		base = &http.Client{}
	}
	if base.Transport != nil {
		if _, ok := base.Transport.(*http.Transport); !ok {
			return nil, fmt.Errorf("unexpected asset transport %T", base.Transport)
		}
	}
	client := *base
	client.Transport = nodeTransport{policy}
	return &client, nil
}

type promiseResult struct {
	value js.Value
	err   error
}

func await(ctx context.Context, promise js.Value) (js.Value, error) {
	result := make(chan promiseResult, 1)
	var success, failure js.Func
	release := func() {
		success.Release()
		failure.Release()
	}
	success = js.FuncOf(func(_ js.Value, args []js.Value) any {
		defer release()
		result <- promiseResult{value: args[0]}
		return nil
	})
	failure = js.FuncOf(func(_ js.Value, args []js.Value) any {
		defer release()
		result <- promiseResult{err: errors.New(args[0].Call("toString").String())}
		return nil
	})
	promise.Call("then", success, failure)
	select {
	case r := <-result:
		return r.value, r.err
	case <-ctx.Done():
		return js.Undefined(), ctx.Err()
	}
}

type nodeResolver struct{}

func (nodeResolver) LookupNetIP(ctx context.Context, _, hostname string) ([]netip.Addr, error) {
	records, err := await(ctx, nodeHTTP.Call("lookup", hostname))
	if err != nil {
		return nil, err
	}
	addresses := make([]netip.Addr, records.Length())
	for i := range addresses {
		addresses[i], err = netip.ParseAddr(records.Index(i).String())
		if err != nil {
			return nil, err
		}
	}
	return addresses, nil
}

type nodeTransport struct{ Policy }

func (t nodeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Method != http.MethodGet || (req.URL.Scheme != "http" && req.URL.Scheme != "https") {
		return nil, fmt.Errorf("unsupported asset request: %s %s", req.Method, req.URL.Scheme)
	}
	ctx := req.Context()
	host := req.URL.Hostname()
	var addresses []netip.Addr
	var err error
	if !t.AllowPrivateNetworks {
		// This is the same validation used by D2's native TCP dialer, including
		// mixed DNS answers, reserved IP ranges and cloud metadata hostnames.
		addresses, err = resolvePublicAddresses(ctx, nodeResolver{}, "tcp", host)
	} else {
		addresses, err = (nodeResolver{}).LookupNetIP(ctx, "ip", host)
	}
	if err != nil {
		return nil, err
	}
	if len(addresses) == 0 {
		return nil, errors.New("asset hostname resolved to no addresses")
	}
	headers := js.Global().Get("Object").New()
	for name, values := range req.Header {
		list := js.Global().Get("Array").New(len(values))
		for i, value := range values {
			list.SetIndex(i, value)
		}
		headers.Set(name, list)
	}
	for _, address := range addresses {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		request := nodeHTTP.Call("open", req.URL.Scheme, address.String(), host, req.URL.Port(), req.URL.Host, req.URL.RequestURI(), headers)
		stop := context.AfterFunc(ctx, func() { request.Call("close") })
		var response js.Value
		response, err = await(ctx, request.Get("response"))
		if err != nil {
			stop()
			request.Call("close")
			continue
		}
		headers := make(http.Header)
		raw := response.Get("headers")
		for i := 0; i < raw.Length(); i += 2 {
			headers.Add(raw.Index(i).String(), raw.Index(i+1).String())
		}
		length, err := strconv.ParseInt(headers.Get("Content-Length"), 10, 64)
		if err != nil {
			length = -1
		}
		code := response.Get("status").Int()
		return &http.Response{
			Request: req, Header: headers, ContentLength: length, StatusCode: code,
			Status: fmt.Sprintf("%d %s", code, http.StatusText(code)),
			Body:   &nodeBody{ctx: ctx, request: request, stop: stop},
		}, nil
	}
	return nil, err
}

// Supply one socket chunk at a time. D2's existing resolver enforces its
// fetched-byte, decoded-byte, image format and dimension limits on this reader.
type nodeBody struct {
	ctx     context.Context
	request js.Value
	stop    func() bool
	buf     []byte
}

func (b *nodeBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if len(b.buf) == 0 {
		chunk, err := await(b.ctx, b.request.Call("read"))
		if err != nil {
			return 0, err
		}
		if chunk.IsNull() {
			return 0, io.EOF
		}
		b.buf = make([]byte, chunk.Length())
		js.CopyBytesToGo(b.buf, chunk)
	}
	n := copy(p, b.buf)
	b.buf = b.buf[n:]
	return n, nil
}

func (b *nodeBody) Close() error {
	b.stop()
	b.request.Call("close")
	return nil
}
