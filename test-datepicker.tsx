import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactDatePicker from 'react-datepicker';

function CustomHeader(props: any) {
  console.log("PROPS RECEIVED:", Object.keys(props));
  return <div>Header</div>;
}

const html = renderToString(<ReactDatePicker renderCustomHeader={CustomHeader} onChange={() => {}} />);
